/**
 * NTN-F 종목별 매수·매도수익률 — 주문·현금흐름·서버 재확인(send-order)이 쓰는 값.
 * (오너 결정, 2026-10-09 — 실제 체결 가능한 값 우선, 매수·매도를 같은 기준 시각 쌍으로)
 *
 * 1순위: 재무부 거래 플랫폼 실시간 호가(지금 체결 가능한 값). 같은 시각 같은 종목의 매수·매도 쌍.
 *        매수 호가가 없는 종목(신규모집이 아님)은 같은 시각 다른 종목들의 호가차 중앙값으로
 *        매수 = 실시간 매도 − 호가차 (추정, 화면 '추정' 표시).
 * 2순위: 실시간이 없으면 최신 재무부 CSV 같은 기준일의 Taxa Compra / Taxa Venda 원값
 *        (전날 오전 호가 — 화면에 "실시간 없음" 경고).
 * ANBIMA 기관 지표는 쓰지 않는다 — 실제 체결 단가와 최대 0.15% 차이, 하루 늦은 자료라 시차 오류.
 * (10년물 금리 차트만 ANBIMA 중간값을 쓴다 — 스크립트 쪽.)
 *
 * 부호: 재무부는 투자자 매수수익률(Taxa Compra)이 매도(Taxa Venda)보다 낮다(CSV 2018~2026 전 종목·
 * 전 영업일 매도 − 매수 = +0.12%p). 호가차가 0 이하이거나 0.5%p 를 넘는 쌍은 쓰지 않는다(고치지 않는다).
 * 둘 다 못 구하면 매수·매도수익률을 비우고 사유(note)를 남긴다.
 */

export const MAX_SPREAD_PCT = 0.5;

/** 소수 4자리 반올림 — 부동소수 찌꺼기만 정리한다(원값은 소수 2자리) */
export const r4 = (x) => Math.round(x * 1e4) / 1e4;

const isNum = (x) => typeof x === "number" && Number.isFinite(x);
const validSpread = (s) => isNum(s) && s > 0 && s <= MAX_SPREAD_PCT;

/**
 * @param {object} p
 * @param {string[]} p.maturities 만기일(YYYY-MM-DD) 목록
 * @param {Map<string, Map<string, {buy: number|null, sell: number|null}>>} p.csvByDate 기준일 → 만기 → CSV 매수·매도수익률
 * @param {{date: string, buy: Map<string, number>, sell: Map<string, number>} | null} p.live 실시간(같은 시각) 매수·매도수익률
 * @returns {Map<string, object>} 만기 → 시세
 */
export function buildOrderQuotes({ maturities, csvByDate, live }) {
  const csvDates = [...csvByDate.keys()].sort().reverse();

  // 실시간 같은 시각 매수·매도가 모두 있는 종목의 호가차(매수 호가가 없는 종목 추정용)
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

  const build = (mat, date, source, buy, sell, spreadRef, estimated, note) => ({
    maturityDate: mat,
    quoteDate: date,
    source,
    buyRate: r4(buy),
    sellRate: r4(sell),
    spread: r4(sell - buy),
    spreadRef,
    estimated,
    note,
  });

  const out = new Map();
  for (const mat of maturities) {
    let quote = null;
    const csvLatest = csvDates.find((d) => csvByDate.get(d)?.has(mat)) ?? null;

    // 1순위: 실시간(확정 CSV 보다 오래된 실시간은 쓰지 않는다)
    if (live && (!csvLatest || live.date >= csvLatest)) {
      const lb = live.buy.get(mat);
      const ls = live.sell.get(mat);
      if (isNum(lb) && isNum(ls) && validSpread(r4(ls - lb))) {
        quote = build(mat, live.date, "live", lb, ls, null, false,
          `${live.date} 재무부 실시간 호가(같은 시각 매수 ${lb}% · 매도 ${ls}%)`);
      } else if (isNum(ls) && liveOther) {
        quote = build(mat, live.date, "live-est", ls - liveOther.spread, ls, liveOther.refs, true,
          `${live.date} 재무부 실시간 매도 ${ls}% − 같은 시각 다른 종목(${liveOther.refs.join(", ")}) 호가차 ${liveOther.spread}%p (매수 호가 없음, 추정)`);
      }
    }

    // 2순위: 최신 CSV 같은 기준일 원값 쌍
    if (!quote) {
      for (const d of csvDates) {
        const c = csvByDate.get(d)?.get(mat);
        if (c && isNum(c.buy) && isNum(c.sell) && validSpread(r4(c.sell - c.buy))) {
          quote = build(mat, d, "csv", c.buy, c.sell, null, false,
            `기준일 ${d}(재무부 CSV 오전 호가) — 실시간 없음`);
          break;
        }
      }
    }

    out.set(
      mat,
      quote ?? {
        maturityDate: mat,
        quoteDate: null,
        source: null,
        buyRate: null,
        sellRate: null,
        spread: null,
        spreadRef: null,
        estimated: false,
        note: "같은 기준 시각의 매수·매도수익률 쌍을 구할 수 없어 수익률을 비웠습니다.",
      }
    );
  }
  return out;
}
