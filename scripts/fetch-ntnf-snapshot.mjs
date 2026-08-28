/**
 * 브라질 재무부 공개 CSV(tesourotransparente.gov.br, 14MB대·인증 불필요)에서
 * NTN-F("Tesouro Prefixado com Juros Semestrais")의 최신 기준일자(Data Base)
 * 시세만 골라 src/lib/server/ntnf-snapshot.json 으로 저장한다.
 *
 * 이 파일이 앱의 브라질채권검색 데이터 소스다(요청 시점에 14MB를 받지 않는다).
 * GitHub Actions(.github/workflows/refresh-ntnf.yml)가 매주 실행해 갱신 커밋하고,
 * 그 커밋이 Vercel 재배포를 트리거해 최신 시세가 반영된다. 로컬에서 수동
 * 갱신하려면: node scripts/fetch-ntnf-snapshot.mjs
 */
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const CSV_URL =
  "https://www.tesourotransparente.gov.br/ckan/dataset/df56aa42-484a-4a59-8184-7676580c81e3/resource/796d2059-14e9-44e3-80c9-2d9e30b405c1/download/precotaxatesourodireto.csv";

const NTNF_TYPE_PREFIX = "Tesouro Prefixado com Juros Semestrais;";

function parseBrDate(s) {
  const m = s.trim().match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  return m ? `${m[3]}-${m[2]}-${m[1]}` : null;
}

function parseBrNumber(s) {
  const t = s.trim();
  if (!t) return null;
  const n = Number(t.replace(",", "."));
  return Number.isNaN(n) ? null : n;
}

async function main() {
  const startedAt = Date.now();
  console.log(`[fetch-ntnf-snapshot] CSV 다운로드 시작 (14MB대, 수십 초 소요)...`);
  const res = await fetch(CSV_URL);
  if (!res.ok) {
    throw new Error(`tesourotransparente.gov.br 요청 실패 (${res.status})`);
  }
  const text = await res.text();
  console.log(
    `[fetch-ntnf-snapshot] 다운로드 완료: ${(text.length / 1024 / 1024).toFixed(1)}MB, ${((Date.now() - startedAt) / 1000).toFixed(1)}s`
  );

  const rows = [];
  for (const line of text.split("\n")) {
    if (!line.startsWith(NTNF_TYPE_PREFIX)) continue;
    const cols = line.split(";");
    if (cols.length < 7) continue;
    const maturityDate = parseBrDate(cols[1]);
    const dataBase = parseBrDate(cols[2]);
    if (!maturityDate || !dataBase) continue;
    rows.push({
      maturityDate,
      dataBase,
      buyRate: parseBrNumber(cols[3]),
      sellRate: parseBrNumber(cols[4]),
      buyPrice: parseBrNumber(cols[5]),
      sellPrice: parseBrNumber(cols[6]),
    });
  }

  if (rows.length === 0) throw new Error("NTN-F 데이터를 찾을 수 없습니다.");

  let asOfDate = rows[0].dataBase;
  for (const r of rows) if (r.dataBase > asOfDate) asOfDate = r.dataBase;

  const bonds = rows
    .filter((r) => r.dataBase === asOfDate)
    .map(({ maturityDate, buyRate, sellRate, buyPrice, sellPrice }) => ({
      maturityDate,
      buyRate,
      sellRate,
      buyPrice,
      sellPrice,
    }))
    .sort((a, b) => a.maturityDate.localeCompare(b.maturityDate));

  const snapshot = {
    asOfDate,
    generatedAt: new Date().toISOString(),
    source: CSV_URL,
    bonds,
  };

  const outPath = join(
    dirname(fileURLToPath(import.meta.url)),
    "..",
    "src",
    "lib",
    "server",
    "ntnf-snapshot.json"
  );
  writeFileSync(outPath, JSON.stringify(snapshot, null, 2) + "\n");
  console.log(
    `[fetch-ntnf-snapshot] 저장 완료: ${outPath}\n  기준일 ${asOfDate}, 종목 ${bonds.length}개`
  );
  for (const b of bonds) {
    console.log(`  ${b.maturityDate}  매수 ${b.buyRate}%  매도 ${b.sellRate}%`);
  }
}

main().catch((err) => {
  console.error(`[fetch-ntnf-snapshot] 실패:`, err.message);
  process.exit(1);
});
