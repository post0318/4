/**
 * NTN-F 종목별 매수·매도수익률 = 중간값 ∓ 호가차/2 (오너 지시, 2026-10-09 — "현금흐름도
 * 오류 안 생기게 동일 기준 적용, 중간값 ± 스프레드").
 *
 * 10년물 금리 차트(9f05448)와 같은 기준으로 맞춘다. 종목마다 한 기준일(D)을 고르고,
 * 그 날짜의 값만 쓴다(다른 날·다른 출처 값을 섞지 않는다).
 *
 * 중간값(mid) — 차트와 같은 우선순위:
 *   1. ANBIMA 기관 지표(Tx. Indicativas, 종가)
 *   2. 재무부 CSV (Taxa Compra + Taxa Venda) / 2 (같은 기준일)
 *   3. 실시간 (매수 + 매도) / 2 (같은 시각) — 실시간 매도만 있으면 매도 − 호가차/2 (추정)
 *
 * 호가차(spread) = 같은 시점·같은 출처의 매도수익률 − 매수수익률:
 *   1. 재무부 CSV 같은 기준일 같은 종목 쌍
 *   2. 실시간 같은 시각 같은 종목 쌍(신규모집 종목)
 *   3. 실시간 같은 시각 다른 종목 쌍의 중앙값 (추정 — 화면에 '추정' 표시)
 *   ANBIMA 의 Tx. Compra/Tx. Venda 는 기관 간 시장 호가(매수 금리 > 매도 금리, 차 0.02~0.04%p)라
 *   재무부(투자자) 호가차와 정의·부호가 달라 쓰지 않는다.
 *
 * 부호: 재무부는 투자자 매수수익률(Taxa Compra)이 매도(Taxa Venda)보다 낮다(CSV 2018~2026
 * 전 종목·전 영업일 매도 − 매수 = +0.12%p). 그래서 매수 = mid − spread/2, 매도 = mid + spread/2.
 * 호가차가 0 이하이거나 0.5%p 를 넘으면 그 출처는 쓰지 않는다(값을 고치지 않는다).
 *
 * 그 날짜에 중간값과 호가차를 함께 구할 수 없으면 더 이른 기준일로 내려가고, 끝내 못 구하면
 * 매수·매도수익률을 비우고 사유(reason)를 남긴다.
 */

export const MAX_SPREAD_PCT = 0.5;

/** 소수 4자리(ANBIMA 지표 정밀도) 반올림 — 부동소수 찌꺼기만 정리한다 */
export const r4 = (x) => Math.round(x * 1e4) / 1e4;

const isNum = (x) => typeof x === "number" && Number.isFinite(x);
const validSpread = (s) => isNum(s) && s > 0 && s <= MAX_SPREAD_PCT;

const MID_LABEL = {
  anbima: "ANBIMA 기관 지표",
  csv: "재무부 CSV (매수+매도)/2",
  live: "실시간 (매수+매도)/2",
  "live-sell": "실시간 매도 − 호가차/2",
};

function spreadLabel(source, refs) {
  if (source === "csv") return "재무부 CSV 매도−매수";
  if (source === "live") return "실시간 같은 시각 매도−매수";
  return `실시간 같은 시각 다른 종목(${refs.join(", ")}) 매도−매수`;
}

/**
 * @param {object} p
 * @param {string[]} p.maturities 만기일(YYYY-MM-DD) 목록
 * @param {Map<string, Map<string, {buy: number|null, sell: number|null}>>} p.csvByDate 기준일 → 만기 → CSV 매수·매도수익률
 * @param {Map<string, Map<string, number>>} p.anbimaByDate 기준일 → 만기 → ANBIMA 지표금리
 * @param {{date: string, buy: Map<string, number>, sell: Map<string, number>} | null} p.live 실시간(같은 시각) 매수·매도수익률
 * @returns {Map<string, object>} 만기 → 시세
 */
export function buildMidSpreadQuotes({ maturities, csvByDate, anbimaByDate, live }) {
  const dateSet = new Set([...csvByDate.keys(), ...anbimaByDate.keys()]);
  if (live?.date) dateSet.add(live.date);
  const dates = [...dateSet].sort().reverse();

  // 실시간 같은 시각 매수·매도가 모두 있는 종목의 호가차(다른 종목 추정용)
  const livePairs = [];
  if (live) {
    for (const [mat, sell] of live.sell) {
      const buy = live.buy.get(mat);
      if (isNum(buy) && isNum(sell) && validSpread(r4(sell - buy))) livePairs.push({ mat, spread: r4(sell - buy) });
    }
  }
  livePairs.sort((a, b) => a.spread - b.spread);
  const liveOther = livePairs.length
    ? { spread: livePairs[Math.floor(livePairs.length / 2)].spread, refs: livePairs.map((p) => p.mat) }
    : null;

  const out = new Map();
  for (const mat of maturities) {
    let quote = null;
    for (const D of dates) {
      const csv = csvByDate.get(D)?.get(mat);
      const csvPair = csv && isNum(csv.buy) && isNum(csv.sell) ? csv : null;
      const liveHere = live && live.date === D;
      const lb = liveHere ? live.buy.get(mat) : undefined;
      const ls = liveHere ? live.sell.get(mat) : undefined;
      const an = anbimaByDate.get(D)?.get(mat);

      let spread = null;
      let spreadSource = null;
      let spreadRef = null;
      if (csvPair && validSpread(r4(csvPair.sell - csvPair.buy))) {
        spread = r4(csvPair.sell - csvPair.buy);
        spreadSource = "csv";
      } else if (isNum(lb) && isNum(ls) && validSpread(r4(ls - lb))) {
        spread = r4(ls - lb);
        spreadSource = "live";
      } else if (liveHere && liveOther) {
        spread = liveOther.spread;
        spreadSource = "live-other";
        spreadRef = liveOther.refs;
      }
      if (spread == null) continue;

      let mid = null;
      let midSource = null;
      if (isNum(an)) {
        mid = an;
        midSource = "anbima";
      } else if (csvPair) {
        mid = (csvPair.buy + csvPair.sell) / 2;
        midSource = "csv";
      } else if (isNum(lb) && isNum(ls)) {
        mid = (lb + ls) / 2;
        midSource = "live";
      } else if (isNum(ls)) {
        mid = ls - spread / 2;
        midSource = "live-sell";
      }
      if (mid == null) continue;

      mid = r4(mid);
      const estimated = spreadSource === "live-other" || midSource === "live-sell";
      quote = {
        maturityDate: mat,
        quoteDate: D,
        midRate: mid,
        spread,
        buyRate: r4(mid - spread / 2),
        sellRate: r4(mid + spread / 2),
        midSource,
        spreadSource,
        spreadRef,
        estimated,
        note: `${D} 중간값 ${mid}% [${MID_LABEL[midSource]}] ∓ 호가차 ${spread}%p/2 [${spreadLabel(spreadSource, spreadRef)}]`,
        inputs: {
          anbima: isNum(an) ? an : null,
          csvBuy: csvPair ? csvPair.buy : null,
          csvSell: csvPair ? csvPair.sell : null,
          liveBuy: isNum(lb) ? lb : null,
          liveSell: isNum(ls) ? ls : null,
        },
      };
      break;
    }
    out.set(
      mat,
      quote ?? {
        maturityDate: mat,
        quoteDate: null,
        midRate: null,
        spread: null,
        buyRate: null,
        sellRate: null,
        midSource: null,
        spreadSource: null,
        spreadRef: null,
        estimated: false,
        note: "같은 기준일의 중간값과 호가차를 함께 구할 수 없어 수익률을 비웠습니다.",
        inputs: null,
      }
    );
  }
  return out;
}
