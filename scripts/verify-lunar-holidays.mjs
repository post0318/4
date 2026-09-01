/**
 * koreaCalendar.ts 의 LUNAR_HOLIDAYS 표(설날·부처님오신날·추석 양력일)를
 * 한국천문연구원(KASI) 음양력 API로 대조한다.
 *
 * 사용법:
 *   1. https://www.data.go.kr 에서 "한국천문연구원_음력일정보" 활용신청 → 인증키 발급
 *   2. KASI_KEY 환경변수에 넣고 실행:
 *        KASI_KEY="발급받은키(디코딩된 일반 인증키)" node scripts/verify-lunar-holidays.mjs
 *
 * 불일치하는 항목만 출력한다. 아무것도 안 나오면 표가 KASI와 완전 일치.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const KEY = process.env.KASI_KEY;
if (!KEY) {
  console.error("KASI_KEY 환경변수가 필요합니다. (data.go.kr 음력일정보 인증키, 디코딩본)");
  process.exit(1);
}

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = readFileSync(
  join(HERE, "..", "src", "lib", "cashflow", "koreaCalendar.ts"),
  "utf-8"
);

// LUNAR_HOLIDAYS 표 파싱: "2027: ["2027-02-07", "2027-05-13", "2027-09-15"],"
const table = {};
for (const m of SRC.matchAll(
  /^\s*(\d{4}):\s*\["(\d{4}-\d{2}-\d{2})",\s*"(\d{4}-\d{2}-\d{2})",\s*"(\d{4}-\d{2}-\d{2})"\]/gm
)) {
  table[m[1]] = { seol: m[2], buddha: m[3], chuseok: m[4] };
}
const years = Object.keys(table);
if (years.length === 0) {
  console.error("표를 파싱하지 못했습니다.");
  process.exit(1);
}
console.log(`파싱된 연도: ${years[0]}~${years[years.length - 1]} (${years.length}개)`);

const BASE =
  "https://apis.data.go.kr/B090041/openapi/service/LrsrCldInfoService/getSolCalInfo";

/** 음력(lunYear/lunMonth/lunDay) → 양력 "YYYY-MM-DD" */
async function lunarToSolar(lunYear, lunMonth, lunDay) {
  const url =
    `${BASE}?serviceKey=${encodeURIComponent(KEY)}` +
    `&lunYear=${lunYear}&lunMonth=${String(lunMonth).padStart(2, "0")}` +
    `&lunDay=${String(lunDay).padStart(2, "0")}`;
  const res = await fetch(url);
  const xml = await res.text();
  const y = xml.match(/<solYear>(\d+)<\/solYear>/)?.[1];
  const mo = xml.match(/<solMonth>(\d+)<\/solMonth>/)?.[1];
  const d = xml.match(/<solDay>(\d+)<\/solDay>/)?.[1];
  if (!y || !mo || !d) {
    const err =
      xml.match(/<returnAuthMsg>([^<]+)<\/returnAuthMsg>/)?.[1] ||
      xml.match(/<errMsg>([^<]+)<\/errMsg>/)?.[1] ||
      xml.slice(0, 200);
    throw new Error(`API 응답 파싱 실패 (${lunYear}-${lunMonth}-${lunDay}): ${err}`);
  }
  return `${y}-${mo.padStart(2, "0")}-${d.padStart(2, "0")}`;
}

const HOLIDAYS = [
  ["seol", "설날", 1, 1],
  ["buddha", "부처님오신날", 4, 8],
  ["chuseok", "추석", 8, 15],
];

let mismatches = 0;
for (const year of years) {
  for (const [key, name, lm, ld] of HOLIDAYS) {
    const expected = table[year][key];
    let actual;
    try {
      actual = await lunarToSolar(Number(year), lm, ld);
    } catch (e) {
      console.log(`  ${year} ${name}: 조회 실패 — ${e.message}`);
      mismatches++;
      continue;
    }
    if (actual !== expected) {
      console.log(
        `  ✗ ${year} ${name}: 표 ${expected}  vs  KASI ${actual}`
      );
      mismatches++;
    }
    await new Promise((r) => setTimeout(r, 120)); // rate limit 여유
  }
}

console.log(
  mismatches === 0
    ? "\n✅ 전 연도 KASI와 일치."
    : `\n⚠️  불일치/실패 ${mismatches}건 — 위 항목을 KASI 웹(astro.kasi.re.kr)에서 재확인.`
);
process.exit(mismatches === 0 ? 0 : 1);
