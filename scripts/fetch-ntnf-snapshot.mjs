/**
 * 브라질 재무부 공개 CSV(tesourotransparente.gov.br, 14MB대·인증 불필요)에서
 * NTN-F("Tesouro Prefixado com Juros Semestrais")의 최신 기준일자(Data Base)
 * 시세만 골라 src/lib/server/ntnf-snapshot.json 으로 저장한다.
 *
 * 이 파일이 앱의 브라질채권검색 데이터 소스다(요청 시점에 14MB를 받지 않는다).
 * GitHub Actions(.github/workflows/refresh-ntnf.yml)가 매주 실행해 갱신 커밋하고,
 * 그 커밋이 Vercel 재배포를 트리거해 최신 시세가 반영된다. 로컬에서 수동
 * 갱신하려면: node scripts/fetch-ntnf-snapshot.mjs
 *
 * ── 실시간 보정(오너 지시, 2026-09-24) ──
 * 정부 CSV가 며칠씩 멈추는 사고가 있어, 거래 플랫폼(tesourodireto.com.br —
 * CSV와는 별개 시스템)의 실시간 API로 값을 보정한다. `/o/rentabilidade/resgatar`
 * (매도/상환)는 NTN-F 6종목이 항상 다 나오지만, `/o/rentabilidade/investir`
 * (매수)는 재무부가 신규모집 중인 종목만 나온다(현재 1개뿐). CSV가 죽어도
 * 매도가는 6종목 다 최신화되지만, 매수가(buyYieldPct — 실제 매수 계산에 쓰는
 * 값)는 신규모집 종목만 최신화되고 나머지는 CSV 값이 남는다 — 절반짜리 보정.
 * 보정된 필드는 `buyLive`/`sellLive` 로 표시해 화면에서 구분할 수 있게 한다.
 * 이 API 자체가 죽어도(옛 경로처럼) 전체 스냅샷 생성은 실패하지 않는다 —
 * try/catch 로 감싸 실패 시 CSV 값 그대로 둔다.
 */
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const CSV_URL =
  "https://www.tesourotransparente.gov.br/ckan/dataset/df56aa42-484a-4a59-8184-7676580c81e3/resource/796d2059-14e9-44e3-80c9-2d9e30b405c1/download/precotaxatesourodireto.csv";

const LIVE_ORIGIN = "https://www.tesourodireto.com.br";
const LIVE_HEADERS = {
  accept: "application/json, text/plain, */*",
  "accept-language": "pt-BR,pt;q=0.9",
  origin: "https://tesourodireto.com.br",
  referer: "https://tesourodireto.com.br/",
  "sec-fetch-dest": "empty",
  "sec-fetch-mode": "cors",
  "sec-fetch-site": "same-site",
  "user-agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36",
};
const NTNF_LIVE_NAME_PREFIX = "Tesouro Prefixado com Juros Semestrais";

/** maturityDate(YYYY-MM-DD)만 뽑는다 — 거래 플랫폼 응답은 "YYYY-MM-DDTHH:mm" 형식 */
function isoDateOnly(s) {
  return typeof s === "string" ? s.slice(0, 10) : null;
}

async function fetchLiveNtnf(path) {
  const res = await fetch(`${LIVE_ORIGIN}${path}`, { headers: LIVE_HEADERS });
  if (!res.ok) throw new Error(`${path} 요청 실패 (${res.status})`);
  const json = await res.json();
  const list = Array.isArray(json.TesouroLegado) ? json.TesouroLegado : [];
  const byMaturity = new Map();
  for (const x of list) {
    if (!String(x.treasuryBondName ?? "").startsWith(NTNF_LIVE_NAME_PREFIX)) continue;
    const maturityDate = isoDateOnly(x.maturityDate);
    if (!maturityDate) continue;
    byMaturity.set(maturityDate, x);
  }
  return byMaturity;
}

/**
 * 거래 플랫폼 실시간 시세로 스냅샷을 보정한다. 실패해도 던지지 않고 null을
 * 반환한다 — CSV 스냅샷 생성 자체를 막으면 안 되기 때문.
 */
async function fetchLiveOverlay() {
  const [resgatar, investir] = await Promise.all([
    fetchLiveNtnf("/o/rentabilidade/resgatar"),
    fetchLiveNtnf("/o/rentabilidade/investir"),
  ]);
  if (resgatar.size === 0 && investir.size === 0) return null;

  let liveAsOfDate = null;
  for (const x of [...resgatar.values(), ...investir.values()]) {
    const d = isoDateOnly(x.lastMarketPricingDate);
    if (d && (!liveAsOfDate || d > liveAsOfDate)) liveAsOfDate = d;
  }

  return { resgatar, investir, liveAsOfDate };
}

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

/** "14,12%" -> 14.12. 인덱서가 SELIC/IPCA+ 연동인 종목은 숫자가 아니라 null */
function parsePctString(s) {
  if (typeof s !== "string") return null;
  const m = s.trim().match(/^(-?[\d.,]+)%$/);
  if (!m) return null;
  return parseBrNumber(m[1]);
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

  let liveAsOfDate = null;
  try {
    console.log(`[fetch-ntnf-snapshot] 거래 플랫폼 실시간 시세 조회...`);
    const live = await fetchLiveOverlay();
    if (live) {
      liveAsOfDate = live.liveAsOfDate;
      for (const b of bonds) {
        const r = live.resgatar.get(b.maturityDate);
        if (r) {
          const rate = parsePctString(r.redemptionProfitabilityFeeIndexerName);
          if (rate != null && typeof r.unitaryRedemptionValue === "number") {
            b.sellRate = rate;
            b.sellPrice = r.unitaryRedemptionValue;
            b.sellLive = true;
          }
        }
        const i = live.investir.get(b.maturityDate);
        if (i) {
          const rate = parsePctString(i.investmentProfitabilityIndexerName);
          if (rate != null && typeof i.unitaryInvestmentValue === "number") {
            b.buyRate = rate;
            b.buyPrice = i.unitaryInvestmentValue;
            b.buyLive = true;
          }
        }
      }
      console.log(
        `[fetch-ntnf-snapshot] 실시간 보정 완료: 기준일 ${liveAsOfDate}, 매도 ${live.resgatar.size}종목·매수 ${live.investir.size}종목`
      );
    } else {
      console.log(`[fetch-ntnf-snapshot] 실시간 보정 생략(응답 없음)`);
    }
  } catch (err) {
    console.log(`[fetch-ntnf-snapshot] 실시간 보정 실패, CSV 값 유지: ${err.message}`);
  }

  const snapshot = {
    asOfDate,
    generatedAt: new Date().toISOString(),
    source: CSV_URL,
    liveAsOfDate,
    liveSource: liveAsOfDate ? `${LIVE_ORIGIN}/o/rentabilidade/{resgatar,investir}` : null,
    bonds,
  };

  const serverDir = join(
    dirname(fileURLToPath(import.meta.url)),
    "..",
    "src",
    "lib",
    "server"
  );

  const outPath = join(serverDir, "ntnf-snapshot.json");
  writeFileSync(outPath, JSON.stringify(snapshot, null, 2) + "\n");
  console.log(
    `[fetch-ntnf-snapshot] 저장 완료: ${outPath}\n  기준일 ${asOfDate}, 종목 ${bonds.length}개`
  );
  for (const b of bonds) {
    console.log(`  ${b.maturityDate}  매수 ${b.buyRate}%  매도 ${b.sellRate}%`);
  }

  // ── 브라질 장기국채금리 추이 (NTN-F ~10년) ──
  // NTN-F 개별 종목은 발행~상환 기간만 존재해 7년 연속 히스토리가 없다. 그래서
  // 매 영업일마다 "만기가 (해당일+10년)에 가장 가까운 NTN-F"의 매도수익률(Taxa
  // Venda)을 골라 롤링 10년물 금리 시계열을 구성한다.
  const cutoff = new Date();
  cutoff.setFullYear(cutoff.getFullYear() - 7);
  const cutoffIso = cutoff.toISOString().slice(0, 10);

  const byDate = new Map();
  for (const r of rows) {
    if (typeof r.sellRate !== "number" || r.dataBase < cutoffIso) continue;
    if (!byDate.has(r.dataBase)) byDate.set(r.dataBase, []);
    byDate.get(r.dataBase).push(r);
  }

  const points = [];
  for (const [date, list] of [...byDate.entries()].sort()) {
    const target = new Date(date);
    target.setFullYear(target.getFullYear() + 10);
    let best = null;
    let bestDiff = Infinity;
    for (const r of list) {
      const diff = Math.abs(new Date(r.maturityDate) - target);
      if (diff < bestDiff) {
        bestDiff = diff;
        best = r;
      }
    }
    if (best) {
      points.push({
        date,
        ytm: best.sellRate,
        maturityYear: Number(best.maturityDate.slice(0, 4)),
      });
    }
  }

  const yieldHistory = {
    label: "브라질 국채금리 (NTN-F ~10년)",
    asOfDate: points.length ? points[points.length - 1].date : asOfDate,
    generatedAt: new Date().toISOString(),
    source: CSV_URL,
    note: "매 영업일 만기가 (해당일+10년)에 가장 가까운 NTN-F의 Taxa Venda",
    points,
  };
  const yieldPath = join(serverDir, "ntnf-yield-history.json");
  writeFileSync(yieldPath, JSON.stringify(yieldHistory, null, 2) + "\n");
  console.log(
    `[fetch-ntnf-snapshot] 금리추이 저장: ${yieldPath}\n  ${points.length}일, 최신 ${yieldHistory.asOfDate} ${
      points.length ? points[points.length - 1].ytm + "%" : ""
    }`
  );
}

main().catch((err) => {
  console.error(`[fetch-ntnf-snapshot] 실패:`, err.message);
  process.exit(1);
});
