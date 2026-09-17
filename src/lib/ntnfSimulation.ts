/**
 * 지금 매수해 만기까지 보유했을 때의 헤알(BRL) 수익률 — 「금리/환율 민감도」
 * 탭(`DurationPanel`) 전용.
 *
 * 롤오버·갈아타기 비교는 여기 있던 옛 계산을 걷어내고 현금흐름 탭과 같은
 * 엔진(`lib/cashflow/trustSimulation.ts`)으로 옮겼다(2026-09-17). 옛 계산은
 * 채권 거래만 봐서 후취보수·세금·경과이자가 빠져 현금흐름 탭과 숫자가
 * 어긋났다. 「시뮬레이션 원본」 탭과 함께 삭제.
 */

import { brazilBusinessDaysBetween } from "@/lib/brazilCalendar";
import {
  computeNtnfPu,
  getOrderSettlementDate,
  parseIsoDate,
  SEMI_COUPON,
  today,
} from "@/lib/ntnfPricing";

const FACE = 1000;
const COUPON = SEMI_COUPON; // 반기 실효쿠폰 (ANBIMA 6자리, ≈ 48.80885)
const BD_YEAR = 252;

/** start 초과 ~ end 이하의 이표일(1/1·7/1) 목록 (UTC 자정) */
function couponDatesBetween(start: Date, end: Date): Date[] {
  const out: Date[] = [];
  for (let y = start.getUTCFullYear() - 1; y <= end.getUTCFullYear() + 1; y++) {
    for (const m of [0, 6]) {
      const d = new Date(Date.UTC(y, m, 1));
      if (d > start && d <= end) out.push(d);
    }
  }
  return out.sort((a, b) => a.getTime() - b.getTime());
}

/**
 * from~receiveUntil 사이 받은 쿠폰들을, 각자 받은 날부터 valueAt까지 annualPct(연,%)로
 * 재투자했을 때의 valueAt 시점 합계 (per título 기준).
 */
function couponsFV(
  from: Date,
  receiveUntil: Date,
  valueAt: Date,
  annualPct: number
): number {
  const y = annualPct / 100;
  let sum = 0;
  for (const c of couponDatesBetween(from, receiveUntil)) {
    const bd = brazilBusinessDaysBetween(c, valueAt);
    sum += COUPON * Math.pow(1 + y, bd / BD_YEAR);
  }
  return sum;
}

function years(from: Date, to: Date): number {
  return brazilBusinessDaysBetween(from, to) / BD_YEAR;
}

/**
 * 지금 매수해 만기까지 보유했을 때의 헤알(BRL) 수익률.
 * @param reinvest false(기본): 쿠폰을 현금으로 받아 재투자하지 않음(일반형).
 *                 true: 쿠폰을 (매수금리 + shiftPct)로 만기까지 재투자(재투자형).
 */
export function holdToMaturityBrl(
  maturity: string,
  buyYieldPct: number,
  shiftPct: number,
  reinvest = false
): {
  annualPct: number;
  totalPct: number;
  /** 쿠폰 제외 — 매수단가에 사서 만기에 액면만 상환받는 BRL 수익률 (par/puBuy − 1) */
  parTotalPct: number;
  years: number;
} | null {
  const settle = getOrderSettlementDate(today());
  const mat = parseIsoDate(maturity);
  if (!mat || mat <= settle) return null;
  const puBuy = computeNtnfPu(maturity, buyYieldPct, settle);
  if (puBuy == null || puBuy <= 0) return null;
  const reinvRate = reinvest ? buyYieldPct + shiftPct : 0;
  const coupons = couponsFV(settle, mat, mat, reinvRate);
  const total = (FACE + coupons) / puBuy - 1;
  const t = Math.max(years(settle, mat), 1 / 365);
  return {
    annualPct: (Math.pow(1 + total, 1 / t) - 1) * 100,
    totalPct: total * 100,
    parTotalPct: (FACE / puBuy - 1) * 100,
    years: t,
  };
}
