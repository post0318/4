/**
 * NTN-F 롤오버 vs 갈아타기 시뮬레이션.
 *  - `holdToMaturityBrl` : 지금 매수해 만기까지 보유 시 헤알 수익률 (DurationPanel용)
 *  - `simulateRollVsSwitch` : 신탁투자원금 기준 롤오버·갈아타기 비교 (SimulationPanel용)
 */

import { brazilBusinessDaysBetween } from "@/lib/brazilCalendar";
import {
  computeNtnfPu,
  getOrderSettlementDate,
  parseIsoDate,
  toISODate,
  today,
} from "@/lib/ntnfPricing";

const FACE = 1000;
const COUPON = FACE * (Math.pow(1.1, 0.5) - 1); // 반기 실효쿠폰 ≈ 48.8088
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
): { annualPct: number; totalPct: number; years: number } | null {
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
    years: t,
  };
}

// ───────────────────────────────────────────────────────────────────
// 롤오버 vs 갈아타기 — "신탁투자원금" 관점 비교
//  ① 롤오버   : 보유종목 A 만기상환 → 대금으로 B 신규매수 → B 만기까지 보유
//  ② 갈아타기 : A 중도매도 → 대금으로 B 신규매수 → B 만기까지 보유
// 두 전략 모두 B 만기에 종료. 핵심 지표는 "신규매수수량 / 기존수량" 증분효과.
// 보유 좌수는 현금흐름 탭 로직대로 (원금 − 선취신탁보수) → 헤알 환산 → PU로
// 나눠 정수 좌수만 매수한다(잔돈은 무이자 이월). 쿠폰은 재투자하지 않고 명목
// 합산. 환율은 단일값(매수=회수).
// ───────────────────────────────────────────────────────────────────

export interface RollSwitchInput {
  /** 신탁투자원금 (원) */
  principalKrw: number;
  /** A 최초투자시점 "YYYY-MM-DD" (없으면 오늘) */
  buyDate?: string;
  /** 보유종목 A */
  bondA: { maturity: string; buyYieldPct: number };
  /** 신규매수 종목 B */
  bondB: { maturity: string };
  /** B 신규매수 수익률 (연 %) */
  buyYieldB: number;
  /** A 중도매도 수익률 (연 %) — 갈아타기용 */
  sellYieldA: number;
  /** 중도매도 시점 "YYYY-MM-DD" */
  sellDate: string;
  /** 헤알화환율 (원/헤알) */
  fxKrwPerBrl: number;
  /** 신탁보수 선취 (%) — 최초 A 매수 시 원금에서 차감 */
  frontFeeInitialPct: number;
  /** 롤오버 선취수수료 (%) */
  frontFeeRollPct: number;
  /** 갈아타기 선취수수료 (%) */
  frontFeeSwitchPct: number;
  /** A 매수가격 직접 지정 (R$, per 좌). 없으면 buyYieldPct로 계산 */
  overrideBuyPriceA?: number | null;
  /** A 매도가격 직접 지정 (R$, per 좌). 없으면 sellYieldA로 계산 */
  overrideSellPriceA?: number | null;
}

export interface RollSwitchLeg {
  key: "rollover" | "switch";
  label: string;
  /** A 청산 시점 */
  exitDate: string;
  /** B 만기 (종료 시점) */
  endDate: string;
  years: number;
  /** A 청산단가 (R$) — 롤오버는 액면 1000, 갈아타기는 매도가 */
  exitPriceA: number;
  /** B 신규매수가 (R$) */
  buyPriceB: number;
  unitsStart: number;
  unitsEnd: number;
  /** 증분효과 = unitsEnd/unitsStart − 1 (%) */
  incrementPct: number;
  /** A 만기효과 (%) — 롤오버: 액면/A매수가−1, 갈아타기: A매도가/A매수가−1 */
  maturityEffectAPct: number;
  /** B 만기효과 (%) = 액면/B매수가 − 1 */
  maturityEffectBPct: number;
  /** 이자효과 (%) = (A쿠폰 + B쿠폰 명목합) ÷ 분모. 총기대수익률 = 증분효과 + 이자효과 + 잔돈 */
  couponEffectPct: number;
  /** 총 기대수익률 (BRL = KRW, 단일환율, 쿠폰 명목 포함, %) */
  totalReturnPct: number;
}

export interface RollSwitchResult {
  rollover: RollSwitchLeg | null;
  switch: RollSwitchLeg | null;
  /** A 최초 매수단가 (R$) */
  buyPriceA: number;
  /** 최초 매수 좌수 (원금 − 선취 → 헤알 환산 → PU로 나눠 절사) */
  units: number;
  /** 선취 신탁보수 (원) */
  frontFeeKrw: number;
}

function nominalCoupons(from: Date, to: Date, units: number): number {
  return units * couponsFV(from, to, to, 0);
}

export function simulateRollVsSwitch(
  input: RollSwitchInput
): RollSwitchResult | null {
  const buy = input.buyDate ? parseIsoDate(input.buyDate) : today();
  if (!buy) return null;
  const settle = getOrderSettlementDate(buy);
  const matA = parseIsoDate(input.bondA.maturity);
  const matB = parseIsoDate(input.bondB.maturity);
  const sell = parseIsoDate(input.sellDate);
  if (!matA || !matB || !sell) return null;

  const puA =
    input.overrideBuyPriceA != null && input.overrideBuyPriceA > 0
      ? input.overrideBuyPriceA
      : computeNtnfPu(input.bondA.maturity, input.bondA.buyYieldPct, settle);
  if (puA == null || puA <= 0) return null;
  const fx = input.fxKrwPerBrl;

  // 현금흐름 탭과 동일: (원금 − 선취신탁보수) → 헤알 환산 → PU로 나눠 정수 좌수만
  // 매수하고, 사고 남은 헤알 잔돈은 무이자로 만기까지 이월한다.
  const frontFeeKrw = Math.trunc(
    input.principalKrw * (input.frontFeeInitialPct / 100)
  );
  const availableBrl = (input.principalKrw - frontFeeKrw) / fx;
  const units = Math.floor(availableBrl / puA);
  if (units <= 0) return null;
  const carryBrl0 = availableBrl - units * puA;

  // 수익률 분모 = A 만기상환금액(좌수 × 액면). 신탁투자원금이 아니라 "A를 만기까지
  // 보유해 par로 상환받는 금액"을 기준으로 잡아야, 롤오버·갈아타기 두 전략이
  // 동일 잣대에서 "B 만기까지 보유해 불어난 효과"로 비교된다.
  const investBrl = units * FACE;

  const leg = (
    key: "rollover" | "switch",
    label: string,
    exitDate: Date,
    exitPriceA: number,
    frontFeePct: number
  ): RollSwitchLeg | null => {
    if (!(matB > exitDate)) return null;
    const settleExit = getOrderSettlementDate(exitDate);
    const puB = computeNtnfPu(input.bondB.maturity, input.buyYieldB, settleExit);
    if (puB == null || puB <= 0) return null;

    const proceeds = units * exitPriceA * (1 - frontFeePct / 100);
    const unitsEnd = Math.floor(proceeds / puB);
    const carryBrl = carryBrl0 + (proceeds - unitsEnd * puB);
    const couponsA = nominalCoupons(settle, exitDate, units);
    const couponsB = nominalCoupons(settleExit, matB, unitsEnd);
    const finalBrl = unitsEnd * FACE + couponsA + couponsB + carryBrl;

    const totalReturn = finalBrl / investBrl - 1;
    return {
      key,
      label,
      exitDate: toISODate(exitDate),
      endDate: toISODate(matB),
      years: Math.max(years(settle, matB), 1 / 365),
      exitPriceA,
      buyPriceB: puB,
      unitsStart: units,
      unitsEnd,
      incrementPct: (unitsEnd / units - 1) * 100,
      maturityEffectAPct: (exitPriceA / puA - 1) * 100,
      maturityEffectBPct: (FACE / puB - 1) * 100,
      couponEffectPct: ((couponsA + couponsB) / investBrl) * 100,
      totalReturnPct: totalReturn * 100,
    };
  };

  // ① 롤오버: A 만기상환(액면) → B 매수
  const rollover = leg(
    "rollover",
    "만기상환 후 롤오버",
    matA,
    FACE,
    input.frontFeeRollPct
  );

  // ② 갈아타기: A 중도매도 → B 매수
  const sellPriceA =
    input.overrideSellPriceA != null && input.overrideSellPriceA > 0
      ? input.overrideSellPriceA
      : computeNtnfPu(
          input.bondA.maturity,
          input.sellYieldA,
          getOrderSettlementDate(sell)
        );
  const switchLeg =
    sell > settle && sell < matA && sellPriceA != null
      ? leg("switch", "중도매도 후 갈아타기", sell, sellPriceA, input.frontFeeSwitchPct)
      : null;

  return { rollover, switch: switchLeg, buyPriceA: puA, units, frontFeeKrw };
}
