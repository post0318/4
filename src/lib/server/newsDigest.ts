import "server-only";

import { createHash } from "node:crypto";
import { Redis } from "@upstash/redis";
import { geminiJson, isGeminiConfigured } from "@/lib/server/gemini";

/**
 * 글로벌(영문) 뉴스 제목 → 자연스러운 한국어 제목 + 한 줄 해설(Gemini).
 *
 * 비용을 줄이려고 **기사(제목) 단위로 결과를 저장**하고 처음 보는 제목만 모아 한 번에
 * 부른다. 라우트가 30분마다 재검증하니 실제 호출은 새 기사가 있을 때만 일어난다.
 * 저장소: Upstash Redis(공유 링크와 같은 인스턴스, 키 `news:ai:`), 없으면 프로세스
 * 메모리. 실패한 항목은 null — 호출 쪽이 무료 번역으로 폴백한다.
 *
 * 본문은 가져오지 않는다(Google 뉴스 링크가 리다이렉트라 원문 확보가 불안정).
 * 그래서 해설은 **제목이 말하는 범위 안에서만** 쓰도록 지시한다.
 */

export interface Digest {
  titleKo: string;
  /** NTN-F·헤알 관점 한 줄 해설. 관련이 약하면 빈 문자열 */
  note: string;
}

const KEY_PREFIX = "news:ai:";
const TTL_SEC = 14 * 24 * 3600;
const AI_TIMEOUT_MS = 12_000;

const memory = new Map<string, Digest>();

function redis(): Redis | null {
  const url = process.env.UPSTASH_REDIS_REST_URL ?? process.env.KV_REST_API_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN ?? process.env.KV_REST_API_TOKEN;
  return url && token ? new Redis({ url, token }) : null;
}

const keyOf = (title: string) =>
  KEY_PREFIX + createHash("sha1").update(title).digest("hex").slice(0, 20);

const SYSTEM = `너는 브라질 국채(NTN-F)를 매수하는 한국 금융회사 직원을 위해 영문 뉴스 제목을 정리한다.
입력: 번호가 붙은 영문 기사 제목과 매체명.
각 제목마다:
- titleKo: 자연스러운 한국어 기사 제목. 고유명사는 통용 한글 표기(룰라, 페트로브라스, 헤알), COPOM 등 약어는 그대로. 과장·추가 정보 금지.
- note: 이 소식이 브라질 금리·헤알화·재정·국채에 어떤 의미인지 한 문장(최대 60자). 제목에 없는 사실·수치·전망을 지어내지 말고, 제목이 말하는 범위 안에서만 쓴다. 관련이 약하면 빈 문자열.
출력: {"items":[{"id":번호,"titleKo":"...","note":"..."}]} JSON 하나만.`;

/** titles 순서대로 Digest | null. 절대 throw 하지 않는다. */
export async function digestTitles(
  items: { title: string; source: string }[]
): Promise<(Digest | null)[]> {
  if (!isGeminiConfigured() || items.length === 0) return items.map(() => null);
  const store = redis();
  const keys = items.map((it) => keyOf(it.title));
  const out: (Digest | null)[] = items.map((_, i) => memory.get(keys[i]) ?? null);

  if (store && out.some((d) => !d)) {
    try {
      const got = await store.mget<(Digest | null)[]>(...keys);
      got.forEach((d, i) => {
        if (!out[i] && d?.titleKo) {
          out[i] = d;
          memory.set(keys[i], d);
        }
      });
    } catch {
      // 저장소 장애 — 아래에서 새로 부른다
    }
  }

  const missing = out.flatMap((d, i) => (d ? [] : [i]));
  if (missing.length === 0) return out;

  try {
    const user = missing
      .map((i, n) => `${n + 1}. ${items[i].title} (${items[i].source})`)
      .join("\n");
    const text = await geminiJson({ system: SYSTEM, user, timeoutMs: AI_TIMEOUT_MS });
    const parsed = JSON.parse(text) as {
      items?: { id?: number; titleKo?: unknown; note?: unknown }[];
    };
    const fresh: [string, Digest][] = [];
    for (const r of parsed.items ?? []) {
      const i = missing[(r.id ?? 0) - 1];
      if (i === undefined || typeof r.titleKo !== "string" || !r.titleKo.trim()) continue;
      const d: Digest = {
        titleKo: r.titleKo.trim(),
        note: typeof r.note === "string" ? r.note.trim() : "",
      };
      out[i] = d;
      memory.set(keys[i], d);
      fresh.push([keys[i], d]);
    }
    if (store && fresh.length) {
      const p = store.pipeline();
      for (const [k, d] of fresh) p.set(k, d, { ex: TTL_SEC });
      await p.exec().catch(() => {});
    }
  } catch (err) {
    console.warn("[newsDigest] Gemini 실패, 무료 번역으로 폴백:", err instanceof Error ? err.message : err);
  }
  return out;
}
