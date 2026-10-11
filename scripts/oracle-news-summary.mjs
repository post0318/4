#!/usr/bin/env node
/**
 * 오라클 서버용 글로벌 뉴스 요약 스케줄러(B 경로, **비용 0** — 결제 미연결 무료 Gemini 키).
 *
 *  1. 사이트 GET /api/news-summary/pending → 요약 안 된 기사 + 모델 입력문(원문 본문 포함)
 *  2. 기사마다 Gemini API(REST) 호출. 본문을 못 뽑은 기사는 url_context 로 모델이 링크를 읽는다
 *  3. 출력 원문을 POST /api/news-summary/ingest 로 넣는다(파싱·검증은 사이트가 한다)
 *
 * 처음엔 Gemini CLI + 정액 구독 로그인으로 하려 했으나 Google 이 개인용 CLI 로그인을
 * 막았다("no longer supported for Gemini Code Assist for individuals", 2026-10-11 확인).
 * CLI 는 링크 읽기 도구 승인 대기로 멈추기도 해서 REST 직접 호출로 바꿨다.
 *
 * 환경변수: NEWS_INGEST_TOKEN(필수), GEMINI_API_KEY(필수, AQ. 형식 무료 키),
 *          SITE_URL(기본 https://brazil-world.vercel.app), GEMINI_MODEL(기본 gemini-3.5-flash — 무료 등급에서 최신 Flash 는 100초+ 지연, 2026-10-11 실측)
 * 실행: run.sh 를 cron 30분마다(flock 으로 겹침 방지). 새 기사가 없으면 Gemini 를 부르지 않는다.
 */

const SITE = (process.env.SITE_URL ?? "https://brazil-world.vercel.app").replace(/\/$/, "");
const TOKEN = process.env.NEWS_INGEST_TOKEN;
const KEY = process.env.GEMINI_API_KEY?.trim();
const MODEL = process.env.GEMINI_MODEL?.trim() || "gemini-3.5-flash";
const PER_ITEM_TIMEOUT_MS = 120_000;
// 무료 등급 분당 요청 한도에 걸리지 않도록 기사 사이 간격
const GAP_MS = 7_000;

if (!TOKEN || !KEY) {
  console.error("NEWS_INGEST_TOKEN / GEMINI_API_KEY 미설정");
  process.exit(1);
}
const auth = { authorization: `Bearer ${TOKEN}` };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function gemini(prompt, input, readUrl) {
  const body = {
    systemInstruction: { parts: [{ text: prompt }] },
    contents: [{ role: "user", parts: [{ text: input }] }],
    generationConfig: { temperature: 0.2, maxOutputTokens: 8000 },
  };
  if (readUrl) body.tools = [{ url_context: {} }];
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`,
    {
      method: "POST",
      headers: { "content-type": "application/json", "x-goog-api-key": KEY },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(PER_ITEM_TIMEOUT_MS),
    }
  );
  const j = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(`Gemini ${res.status}: ${j.error?.message?.slice(0, 200) ?? "unknown"}`);
    err.status = res.status;
    throw err;
  }
  return (j.candidates?.[0]?.content?.parts ?? [])
    .filter((p) => !p.thought && typeof p.text === "string")
    .map((p) => p.text)
    .join("");
}

const res = await fetch(`${SITE}/api/news-summary/pending`, {
  headers: auth,
  signal: AbortSignal.timeout(90_000),
});
if (!res.ok) {
  console.error(new Date().toISOString(), "pending 실패", res.status);
  process.exit(1);
}
const { prompt, items } = await res.json();
console.log(new Date().toISOString(), `대기 ${items.length}건`);

for (const [n, it] of items.entries()) {
  if (n > 0) await sleep(GAP_MS);
  try {
    const output = await gemini(prompt, it.input, !it.fromText);
    const r = await fetch(`${SITE}/api/news-summary/ingest`, {
      method: "POST",
      headers: { ...auth, "content-type": "application/json" },
      body: JSON.stringify({ link: it.link, url: it.url, fromText: it.fromText, output }),
      signal: AbortSignal.timeout(30_000),
    });
    const j = await r.json().catch(() => ({}));
    console.log(r.ok ? (j.unreadable ? "요약불가" : "저장") : `ingest ${r.status}`, "-", it.title);
  } catch (e) {
    // 저장 안 됐으므로 pending 에 남아 다음 회차에 다시 시도된다
    console.error("실패 -", it.title, "-", e.message);
    if (e.status === 429) {
      console.error("무료 한도 도달 — 이번 회차 중단");
      break;
    }
  }
}
