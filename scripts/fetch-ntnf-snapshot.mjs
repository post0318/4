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
 * 값)는 신규모집 종목만 최신화된다. 이 API 자체가 죽어도(옛 경로처럼) 전체
 * 스냅샷 생성은 실패하지 않는다 — try/catch 로 감싸 실패 시 CSV·ANBIMA 로만 만든다.
 *
 * ── 중간값 ± 호가차(오너 지시, 2026-10-09) ──
 * 스냅샷의 buyRate/sellRate 는 원값이 아니라 종목마다 같은 기준일의
 * 중간값 ∓ 호가차/2 다(scripts/lib/ntnf-quote.mjs). 중간값은 금리 차트와 같은 우선순위
 * (ANBIMA 기관 지표 > CSV 평균 > 실시간), 호가차는 같은 시점·같은 출처의 매도 − 매수.
 * 원값은 종목별 inputs 에 남긴다. --out-dir=<폴더> 를 주면 그 폴더에 쓴다(비교용).
 */
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { buildMidSpreadQuotes } from "./lib/ntnf-quote.mjs";

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
  // 거래 플랫폼이 가끔 빈 목록을 돌려준다(특히 자동 실행 서버에서). 매도가 비면 몇 번 다시 시도한다.
  let resgatar = new Map();
  let investir = new Map();
  for (let attempt = 1; attempt <= 4; attempt++) {
    try {
      [resgatar, investir] = await Promise.all([
        fetchLiveNtnf("/o/rentabilidade/resgatar"),
        fetchLiveNtnf("/o/rentabilidade/investir"),
      ]);
    } catch (err) {
      console.log(`[fetch-ntnf-snapshot] 실시간 시세 조회 ${attempt}회 실패: ${err.message}`);
    }
    if (resgatar.size > 0) break;
    console.log(`[fetch-ntnf-snapshot] 실시간 매도 시세가 비어 있음(${attempt}/4)`);
    if (attempt < 4) await new Promise((r) => setTimeout(r, 5000 * attempt));
  }
  // 매도 시세가 없으면 매수만 실시간으로 섞이지 않게 전체를 건너뛴다(CSV 한 날짜 기준으로 일관되게 유지).
  if (resgatar.size === 0) return null;

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

const ANBIMA_BASE = "https://www.anbima.com.br/informacoes/merc-sec/arqs";

/** 만기가 (날짜+10년)에 가장 가까운 항목을 고른다 */
function pickTenYear(date, items) {
  const target = new Date(date);
  target.setFullYear(target.getFullYear() + 10);
  let best = null;
  let bestDiff = Infinity;
  for (const it of items) {
    const diff = Math.abs(new Date(it.maturityDate) - target);
    if (diff < bestDiff) {
      bestDiff = diff;
      best = it;
    }
  }
  return best;
}

/**
 * ANBIMA 기관 간 2차시장 지표금리(Tx. Indicativas) — 매수·매도 구분 없는 중간값.
 * 공개 일일 파일(msYYMMDD.txt)은 최근 3주 안팎만 남으므로, 받을 수 있는 날만 받아 history에 누적한다.
 * 실패하면 빈 결과를 돌려준다(차트는 CSV 중간값·실시간 임시 값으로 계속 만들어진다).
 * 날짜 → { point: 10년물 차트 점, byMaturity: 만기 → 지표금리(전 종목, 스냅샷 중간값용) }
 */
async function fetchAnbimaRecent(days = 28) {
  const out = new Map();
  const today = new Date();
  for (let i = 0; i < days; i++) {
    const d = new Date(today.getTime() - i * 86_400_000);
    const wd = d.getUTCDay();
    if (wd === 0 || wd === 6) continue;
    const yy = String(d.getUTCFullYear()).slice(2);
    const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
    const dd = String(d.getUTCDate()).padStart(2, "0");
    try {
      const res = await fetch(`${ANBIMA_BASE}/ms${yy}${mm}${dd}.txt`, {
        headers: { "user-agent": "Mozilla/5.0" },
        signal: AbortSignal.timeout(20_000),
      });
      if (!res.ok) continue;
      const buf = new TextDecoder("latin1").decode(await res.arrayBuffer());
      let date = null;
      const items = [];
      for (const line of buf.split(String.fromCharCode(10))) {
        const c = line.trim().split("@");
        if (c[0] !== "NTN-F" || c.length < 8) continue;
        date = `${c[1].slice(0, 4)}-${c[1].slice(4, 6)}-${c[1].slice(6, 8)}`;
        const ind = parseBrNumber(c[7]);
        if (ind == null) continue;
        items.push({ maturityDate: `${c[4].slice(0, 4)}-${c[4].slice(4, 6)}-${c[4].slice(6, 8)}`, ind });
      }
      const best = date && items.length ? pickTenYear(date, items) : null;
      if (best) {
        out.set(date, {
          point: { date, ytm: best.ind, maturityYear: Number(best.maturityDate.slice(0, 4)), src: "anbima" },
          byMaturity: new Map(items.map((it) => [it.maturityDate, it.ind])),
        });
      }
    } catch {
      /* 이 날은 건너뜀 */
    }
  }
  return out;
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

  const maturities = [...new Set(rows.filter((r) => r.dataBase === asOfDate).map((r) => r.maturityDate))].sort();

  // CSV 최근 기준일들(중간값·호가차를 같은 기준일에서 맞추기 위해 날짜별로 보관)
  const csvDates = [...new Set(rows.map((r) => r.dataBase))].sort().slice(-30);
  const csvByDate = new Map(csvDates.map((d) => [d, new Map()]));
  for (const r of rows) csvByDate.get(r.dataBase)?.set(r.maturityDate, { buy: r.buyRate, sell: r.sellRate });

  // ANBIMA 기관 지표 — 스냅샷 중간값과 금리 차트가 같은 값을 쓴다
  let anbimaFresh = new Map();
  try {
    anbimaFresh = await fetchAnbimaRecent();
  } catch (err) {
    console.log(`[fetch-ntnf-snapshot] ANBIMA 조회 실패: ${err.message}`);
  }
  const anbimaByDate = new Map([...anbimaFresh].map(([d, v]) => [d, v.byMaturity]));
  const anbimaAsOfDate = [...anbimaByDate.keys()].sort().pop() ?? null;

  // 실시간(거래 플랫폼) — 같은 시각 매수·매도수익률만. 단가는 쓰지 않는다(화면이 수익률로 다시 계산).
  let live = null;
  let liveAsOfDate = null;
  try {
    console.log(`[fetch-ntnf-snapshot] 거래 플랫폼 실시간 시세 조회...`);
    const overlay = await fetchLiveOverlay();
    if (overlay && overlay.liveAsOfDate) {
      liveAsOfDate = overlay.liveAsOfDate;
      live = { date: liveAsOfDate, buy: new Map(), sell: new Map() };
      for (const [mat, r] of overlay.resgatar) {
        const rate = parsePctString(r.redemptionProfitabilityFeeIndexerName);
        if (rate != null) live.sell.set(mat, rate);
      }
      for (const [mat, i] of overlay.investir) {
        const rate = parsePctString(i.investmentProfitabilityIndexerName);
        if (rate != null) live.buy.set(mat, rate);
      }
      console.log(
        `[fetch-ntnf-snapshot] 실시간: 기준일 ${liveAsOfDate}, 매도 ${live.sell.size}종목·매수 ${live.buy.size}종목`
      );
    } else {
      console.log(`[fetch-ntnf-snapshot] 실시간 생략(응답 없음)`);
    }
  } catch (err) {
    console.log(`[fetch-ntnf-snapshot] 실시간 조회 실패: ${err.message}`);
  }

  const quotes = buildMidSpreadQuotes({ maturities, csvByDate, anbimaByDate, live });
  const bonds = maturities.map((m) => quotes.get(m));
  const quoteDates = bonds.map((b) => b.quoteDate).filter(Boolean).sort();

  const snapshot = {
    asOfDate,
    generatedAt: new Date().toISOString(),
    source: CSV_URL,
    liveAsOfDate,
    liveSource: liveAsOfDate ? `${LIVE_ORIGIN}/o/rentabilidade/{resgatar,investir}` : null,
    anbimaAsOfDate,
    /** 종목 시세 기준일 중 가장 이른 날(노후 판정용) */
    quoteAsOfDate: quoteDates[0] ?? null,
    quoteRule:
      "매수·매도수익률 = 중간값 ∓ 호가차/2, 종목마다 같은 기준일. 중간값: ANBIMA 기관 지표 > 재무부 CSV (매수+매도)/2 > 실시간. 호가차: 같은 기준일 CSV 매도−매수 > 실시간 같은 시각 매도−매수(다른 종목이면 추정).",
    bonds,
  };

  const serverDir = join(
    dirname(fileURLToPath(import.meta.url)),
    "..",
    "src",
    "lib",
    "server"
  );
  const outArg = process.argv.find((x) => x.startsWith("--out-dir="));
  const outDir = outArg ? outArg.slice("--out-dir=".length) : serverDir;

  const outPath = join(outDir, "ntnf-snapshot.json");
  writeFileSync(outPath, JSON.stringify(snapshot, null, 2) + "\n");
  console.log(
    `[fetch-ntnf-snapshot] 저장 완료: ${outPath}\n  CSV 기준일 ${asOfDate}, ANBIMA ${anbimaAsOfDate}, 실시간 ${liveAsOfDate}, 종목 ${bonds.length}개`
  );
  for (const b of bonds) {
    console.log(`  ${b.maturityDate}  매수 ${b.buyRate}%  매도 ${b.sellRate}%  ${b.note}`);
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
      // 금리추이는 매수·매도의 중간값(기관 지표와 같은 성격)으로 만든다. 매수 값이 없으면 매도 값.
      const mid =
        typeof best.buyRate === "number" ? Math.round(((best.buyRate + best.sellRate) / 2) * 100) / 100 : best.sellRate;
      points.push({
        date,
        ytm: mid,
        maturityYear: Number(best.maturityDate.slice(0, 4)),
      });
    }
  }

  // 날짜별 우선순위: ANBIMA 기관 지표(종가, 최우선) > CSV 중간값(확정, 오전 호가) > 실시간 임시(가장 최근 하루).
  // ANBIMA 공개 파일은 최근 3주만 남으므로 이전 실행에서 저장한 ANBIMA 점도 보존한다.
  const yieldPath = join(serverDir, "ntnf-yield-history.json");
  const yieldOutPath = join(outDir, "ntnf-yield-history.json");
  const csvLast = points.length ? points[points.length - 1].date : "0000-00-00";
  let previous = [];
  try {
    previous = JSON.parse(readFileSync(yieldPath, "utf8")).points ?? [];
  } catch {
    previous = [];
  }
  const anbima = new Map(previous.filter((p) => p.src === "anbima").map((p) => [p.date, p]));
  let anbimaNew = 0;
  for (const [d, v] of anbimaFresh) {
    if (!anbima.has(d)) anbimaNew++;
    anbima.set(d, v.point);
  }
  console.log(`[fetch-ntnf-snapshot] ANBIMA 기관 지표: 이번에 받은 ${anbimaFresh.size}일(신규 ${anbimaNew}일), 누적 ${anbima.size}일`);
  const byDateMerged = new Map(points.map((p) => [p.date, p]));
  for (const [d, p] of anbima) byDateMerged.set(d, p);
  const lastKnown = [...byDateMerged.keys()].sort().pop() ?? "0000-00-00";

  // 실시간 임시 점: 확정 자료(ANBIMA·CSV)가 아직 없는 날짜만. 스냅샷과 같은 중간값(실시간 기준일 종목).
  const livePoints = new Map(
    previous.filter((p) => p.live === true && p.date > lastKnown).map((p) => [p.date, p])
  );
  if (liveAsOfDate && liveAsOfDate > lastKnown) {
    const liveList = bonds.filter(
      (b) => b.quoteDate === liveAsOfDate && (b.midSource === "live" || b.midSource === "live-sell")
    );
    const best = liveList.length ? pickTenYear(liveAsOfDate, liveList) : null;
    if (best) {
      livePoints.set(liveAsOfDate, {
        date: liveAsOfDate,
        ytm: best.midRate,
        maturityYear: Number(best.maturityDate.slice(0, 4)),
        live: true,
      });
    }
  }
  for (const [d, p] of livePoints) if (!byDateMerged.has(d)) byDateMerged.set(d, p);
  const merged = [...byDateMerged.values()].sort((a, b) => a.date.localeCompare(b.date));

  const yieldHistory = {
    label: "브라질 국채금리 (NTN-F ~10년, 중간값)",
    asOfDate: merged.length ? merged[merged.length - 1].date : asOfDate,
    csvAsOfDate: csvLast,
    anbimaDates: [...anbima.keys()].sort(),
    generatedAt: new Date().toISOString(),
    source: CSV_URL,
    note: "매 영업일 만기가 (해당일+10년)에 가장 가까운 NTN-F의 중간값. ANBIMA 기관 지표(종가, src:anbima) > CSV (Taxa Compra+Taxa Venda)/2(오전 호가) > 실시간 임시(live:true, 확정 자료가 올라오면 교체)",
    points: merged,
  };
  writeFileSync(yieldOutPath, JSON.stringify(yieldHistory, null, 2) + "\n");
  console.log(
    `[fetch-ntnf-snapshot] 금리추이 저장: ${yieldOutPath}\n  ${points.length}일, 최신 ${yieldHistory.asOfDate} ${
      points.length ? points[points.length - 1].ytm + "%" : ""
    }`
  );
}

main().catch((err) => {
  console.error(`[fetch-ntnf-snapshot] 실패:`, err.message);
  process.exit(1);
});
