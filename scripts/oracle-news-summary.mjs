#!/usr/bin/env node
/**
 * 오라클 서버용 글로벌 뉴스 요약 스케줄러(B 경로, 비용 0 — Gemini 정액 구독).
 *
 *  1. 사이트 GET /api/news-summary/pending → 요약 안 된 기사 + 모델 입력문(원문 본문 포함)
 *  2. 기사마다 Gemini CLI(구독 계정으로 로그인된) 를 headless 로 실행
 *  3. 출력 원문을 POST /api/news-summary/ingest 로 넣는다(파싱·검증은 사이트가 한다)
 *
 * 환경변수: SITE_URL(기본 https://brazil-world.vercel.app), NEWS_INGEST_TOKEN(필수),
 *          GEMINI_BIN(기본 gemini), GEMINI_CLI_MODEL(선택 — 비우면 CLI 기본 모델)
 * cron 예: 10분마다  *\/10 * * * *  cd ~/brazil-news && node oracle-news-summary.mjs >> run.log 2>&1
 * 새 기사가 없으면 Gemini 를 부르지 않는다(구독 한도 소모 없음).
 */
import { spawn } from "node:child_process";

const SITE = (process.env.SITE_URL ?? "https://brazil-world.vercel.app").replace(/\/$/, "");
const TOKEN = process.env.NEWS_INGEST_TOKEN;
const BIN = process.env.GEMINI_BIN ?? "gemini";
const MODEL = process.env.GEMINI_CLI_MODEL;
const PER_ITEM_TIMEOUT_MS = 120_000;

if (!TOKEN) {
  console.error("NEWS_INGEST_TOKEN 미설정");
  process.exit(1);
}
const auth = { authorization: `Bearer ${TOKEN}` };

function runGemini(input) {
  return new Promise((resolve, reject) => {
    const args = ["-p", "표준입력의 지시와 기사를 읽고 지시한 JSON 하나만 출력하라."];
    if (MODEL) args.push("-m", MODEL);
    const child = spawn(BIN, args, { stdio: ["pipe", "pipe", "pipe"] });
    let out = "";
    let err = "";
    const timer = setTimeout(() => child.kill("SIGKILL"), PER_ITEM_TIMEOUT_MS);
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (err += d));
    child.on("error", reject);
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) resolve(out);
      else reject(new Error(`gemini exit ${code}: ${err.slice(0, 300)}`));
    });
    child.stdin.end(input);
  });
}

const res = await fetch(`${SITE}/api/news-summary/pending`, { headers: auth });
if (!res.ok) {
  console.error(new Date().toISOString(), "pending 실패", res.status);
  process.exit(1);
}
const { prompt, items } = await res.json();
console.log(new Date().toISOString(), `대기 ${items.length}건`);

for (const it of items) {
  try {
    const output = await runGemini(`${prompt}\n\n---\n${it.input}`);
    const r = await fetch(`${SITE}/api/news-summary/ingest`, {
      method: "POST",
      headers: { ...auth, "content-type": "application/json" },
      body: JSON.stringify({ link: it.link, url: it.url, fromText: it.fromText, output }),
    });
    const j = await r.json().catch(() => ({}));
    console.log(r.ok ? (j.unreadable ? "요약불가" : "저장") : `ingest ${r.status}`, "-", it.title);
  } catch (e) {
    // 다음 회차에 다시 시도된다(저장 안 됐으므로 pending 에 남음)
    console.error("실패 -", it.title, "-", e.message);
  }
}
