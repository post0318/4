import "server-only";

import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { Redis } from "@upstash/redis";
import { GeminiQuotaError, geminiText, isGeminiConfigured } from "@/lib/server/gemini";
import {
  type AltArticle,
  fetchArticleText,
  findAlternateCoverage,
  resolveGoogleNewsUrl,
} from "@/lib/server/newsArticle";

/**
 * 글로벌 뉴스 클릭 요약(오너 지시 2026-10-11, **비용 0 원칙**). 목록은 무료 번역 그대로,
 * 기사를 누르면 저장된 한글 제목 + 요약을 팝업에 띄운다.
 *
 * 요약을 만드는 쪽은 둘 중 하나(둘 다 있어도 된다):
 *  B. 오라클 스케줄러(주 경로) — 서버에서 주기적으로 `pending` API 로 요약 안 된 기사의
 *     원문 본문을 받아 Gemini CLI(정액 구독)로 요약하고 `ingest` API 로 넣는다.
 *     NEWS_INGEST_TOKEN 이 두 API 의 Bearer 토큰. 사이트에는 Gemini 키가 없어도 된다.
 *  A. 클릭 시 생성(선택) — GEMINI_API_KEY(결제 미연결 무료 키)가 있으면 저장본이 없을 때
 *     바로 만든다. 목록에 있던 기사만(서명 sig), 하루 NEWS_SUMMARY_DAILY_CAP(기본 50)건.
 *
 * 저장소: Redis `news:sum:`(14일), 없으면(로컬) 프로세스 메모리.
 */

export interface NewsSummary {
  titleKo: string;
  /** 비어 있으면 "본문을 읽을 수 없었다" 로 확정된 기사(재시도 안 함) */
  bullets: string[];
  /** 실제 원문 URL(디코딩 성공 시). 실패하면 Google 뉴스 링크 */
  url: string;
  /** 본문을 직접 넘겨 요약했는지(false 면 모델이 링크를 열어 읽음) */
  fromText: boolean;
  /** 누가 만들었나 — "oracle" | "click" */
  by: string;
  /** 요약 근거 — article: 원문 본문 · other: 원문을 못 읽어 같은 사건의 다른 매체 기사 ·
   *  link: 모델이 링크를 직접 읽음. 옛 저장본엔 없다 */
  basis?: Basis;
  /** basis=other 일 때 참고한 매체 */
  sources?: { url: string; source: string }[];
  /** 다른 매체 찾기까지 시도했는지 — 옛 "요약 불가" 저장본은 없어서 한 번 더 시도된다 */
  altTried?: boolean;
}

export type Basis = "article" | "other" | "link";

export type SummaryResult =
  | { ok: true; summary: NewsSummary }
  | { ok: false; reason: "pending" | "quota" | "unreadable" | "error" };

const KEY_PREFIX = "news:sum:";
const TTL_SEC = 14 * 24 * 3600;
const AI_TIMEOUT_MS = 25_000;
export const MIN_TEXT = 400;
const DAILY_CAP =
  Number(process.env.NEWS_SUMMARY_DAILY_CAP) > 0 ? Number(process.env.NEWS_SUMMARY_DAILY_CAP) : 50;

const memory = new Map<string, NewsSummary>();
const memoryCount = new Map<string, number>();
const inflight = new Map<string, Promise<SummaryResult>>();

function redis(): Redis | null {
  const url = process.env.UPSTASH_REDIS_REST_URL ?? process.env.KV_REST_API_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN ?? process.env.KV_REST_API_TOKEN;
  return url && token ? new Redis({ url, token }) : null;
}

const keyOf = (link: string) =>
  KEY_PREFIX + createHash("sha1").update(link).digest("hex").slice(0, 20);

// ── 서명(A 경로 전용) ────────────────────────────────────────────────

/** 목록에 실을 링크 서명. 클릭 생성(A)이 꺼져 있으면 null */
export function signNewsLink(link: string): string | null {
  const key = process.env.GEMINI_API_KEY;
  if (!key) return null;
  return createHmac("sha256", key).update("news-link:" + link).digest("base64url").slice(0, 22);
}

function verifyNewsLink(link: string, sig: string): boolean {
  const want = signNewsLink(link);
  if (!want || sig.length !== want.length) return false;
  return timingSafeEqual(Buffer.from(want), Buffer.from(sig));
}

// ── 저장소 ──────────────────────────────────────────────────────────

export async function getCachedSummaries(links: string[]): Promise<(NewsSummary | null)[]> {
  const keys = links.map(keyOf);
  // 메모리는 확정된 것만 믿는다 — 옛 "요약 불가"가 남아 있으면 Redis 의 새 요약을 가린다
  const out = keys.map((k) => {
    const m = memory.get(k) ?? null;
    return m && !needsSummary(m) ? m : null;
  });
  const store = redis();
  if (store && out.some((s) => !s)) {
    try {
      const got = await store.mget<(NewsSummary | null)[]>(...keys);
      got.forEach((s, i) => {
        if (!out[i] && s?.titleKo !== undefined) {
          out[i] = s;
          memory.set(keys[i], s);
        }
      });
    } catch {
      // 저장소 장애 — 없는 것으로
    }
  }
  return out;
}

export async function saveSummary(link: string, summary: NewsSummary): Promise<void> {
  const key = keyOf(link);
  memory.set(key, summary);
  const store = redis();
  if (store) await store.set(key, summary, { ex: TTL_SEC });
}

const toResult = (s: NewsSummary): SummaryResult =>
  s.bullets.length ? { ok: true, summary: s } : { ok: false, reason: "unreadable" };

// ── 원문 준비(두 경로 공통) ─────────────────────────────────────────

export interface PreparedArticle {
  url: string;
  text: string;
  /** 원문을 못 읽었을 때 찾은 같은 사건의 다른 매체 기사 */
  alt: AltArticle[];
}

export async function prepareArticle(link: string, title: string): Promise<PreparedArticle> {
  const url = (await resolveGoogleNewsUrl(link)) ?? link;
  const text = await fetchArticleText(url);
  const alt = text.length >= MIN_TEXT ? [] : await findAlternateCoverage(title, url, MIN_TEXT);
  return { url, text, alt };
}

export function basisOf(a: PreparedArticle): Basis {
  return a.text.length >= MIN_TEXT ? "article" : a.alt.length ? "other" : "link";
}

/** 저장본이 없거나, 옛 "요약 불가" 저장본이라 다른 매체로 한 번 더 해볼 기사 */
export function needsSummary(s: NewsSummary | null): boolean {
  return !s || (s.bullets.length === 0 && !s.altTried);
}

/** 요약 지시문 — 오라클 스크립트도 pending 응답으로 같은 문구를 받아 쓴다 */
export const SUMMARY_PROMPT = `너는 브라질 국채(NTN-F)를 매수하는 한국 금융회사 직원을 위해 영문 기사를 정리한다.
반드시 아래 JSON 하나만 출력한다(코드블록·설명 없이):
{"titleKo":"자연스러운 한국어 기사 제목","bullets":["요약 문장", "..."]}
- bullets 는 3~5개, 각 한 문장(최대 90자), 기사에 있는 사실만. 수치·인명·날짜는 기사 그대로.
- 기사에 없는 전망·평가를 덧붙이지 않는다.
- 고유명사는 통용 한글 표기(룰라, 페트로브라스, 헤알), COPOM 등 약어는 그대로.
- 기사 본문을 읽을 수 없으면 {"titleKo":"","bullets":[]} 를 출력한다.`;

export function articleInput(title: string, a: PreparedArticle): string {
  switch (basisOf(a)) {
    case "article":
      return `제목: ${title}\n원문: ${a.url}\n\n본문:\n${a.text}`;
    case "other":
      return (
        `제목: ${title}\n원문(${a.url})은 유료 구독·접근 차단으로 읽을 수 없어, 같은 사건을 다룬 ` +
        `다른 매체 기사를 준다. 이 기사들이 위 제목과 같은 사건일 때만 그 기사들에 있는 사실로 ` +
        `요약하고(titleKo 는 원문 제목의 번역), 다른 사건이면 빈 JSON 을 출력하라.\n\n` +
        a.alt.map((x, i) => `[다른 매체 ${i + 1}: ${x.source}]\n${x.text}`).join("\n\n")
      );
    default:
      return `제목: ${title}\n아래 링크의 기사를 읽고 정리하라.\n${a.url}`;
  }
}

export function parseSummary(text: string): { titleKo: string; bullets: string[] } | null {
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) return null;
  try {
    const j = JSON.parse(m[0]) as { titleKo?: unknown; bullets?: unknown };
    const titleKo = typeof j.titleKo === "string" ? j.titleKo.trim() : "";
    const bullets = Array.isArray(j.bullets)
      ? j.bullets
          .filter((b): b is string => typeof b === "string" && b.trim() !== "")
          .map((b) => b.trim().slice(0, 200))
      : [];
    return { titleKo: titleKo.slice(0, 200), bullets: titleKo ? bullets.slice(0, 5) : [] };
  } catch {
    return null;
  }
}

// ── A: 클릭 시 생성 ─────────────────────────────────────────────────

/** 한국시간 날짜별 호출 수를 1 올리고, 상한 안이면 true */
async function takeDailySlot(store: Redis | null): Promise<boolean> {
  const day = new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 10);
  const k = `${KEY_PREFIX}count:${day}`;
  if (store) {
    try {
      const n = await store.incr(k);
      if (n === 1) await store.expire(k, 2 * 24 * 3600);
      return n <= DAILY_CAP;
    } catch {
      // 저장소 장애 — 메모리로
    }
  }
  const n = (memoryCount.get(k) ?? 0) + 1;
  memoryCount.set(k, n);
  return n <= DAILY_CAP;
}

async function generateOnClick(link: string, title: string): Promise<SummaryResult> {
  if (!(await takeDailySlot(redis()))) return { ok: false, reason: "quota" };
  const a = await prepareArticle(link, title);
  const basis = basisOf(a);
  const fromText = basis !== "link";
  try {
    const out = await geminiText({
      system: SUMMARY_PROMPT,
      user: articleInput(title, a),
      timeoutMs: AI_TIMEOUT_MS,
      readUrls: !fromText,
    });
    const parsed = parseSummary(out);
    if (!parsed) return { ok: false, reason: "error" };
    const summary: NewsSummary = {
      ...parsed,
      url: a.url,
      fromText,
      by: "click",
      basis,
      sources: basis === "other" ? a.alt.map(({ url, source }) => ({ url, source })) : undefined,
      altTried: true,
    };
    await saveSummary(link, summary).catch(() => {});
    return toResult(summary);
  } catch (err) {
    console.warn("[newsSummary]", err instanceof Error ? err.message : err);
    return { ok: false, reason: err instanceof GeminiQuotaError ? "quota" : "error" };
  }
}

/**
 * 팝업용 — 저장본이 있으면 그것, 없으면 (A 가 켜져 있고 서명이 맞을 때) 만든다.
 * 둘 다 아니면 "pending"(오라클이 곧 만든다).
 */
export async function getNewsSummary(link: string, sig: string, title: string): Promise<SummaryResult> {
  const [cached] = await getCachedSummaries([link]);
  if (cached && !needsSummary(cached)) return toResult(cached);
  if (!isGeminiConfigured() || !verifyNewsLink(link, sig)) return { ok: false, reason: "pending" };
  const key = keyOf(link);
  const running = inflight.get(key);
  if (running) return running;
  const p = generateOnClick(link, title).finally(() => inflight.delete(key));
  inflight.set(key, p);
  return p;
}

// ── B: 오라클 스케줄러용 인증 ───────────────────────────────────────

export function checkIngestToken(req: Request): boolean {
  const want = process.env.NEWS_INGEST_TOKEN;
  if (!want) return false;
  const got = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  return got.length === want.length && timingSafeEqual(Buffer.from(got), Buffer.from(want));
}
