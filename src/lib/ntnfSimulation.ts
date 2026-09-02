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
  SEMI_COUPON,
  toISODate,
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
  /** 참고지표 · 좌수 증가비 = unitsEnd/unitsStart − 1 (%) */
  incrementPct: number;
  /**
   * 만기효과 A (%) — 롤오버: 액면/A매수가−1, 갈아타기: A매도가/A매수가−1.
   * A를 매수단가에 사서 par(또는 매도가)로 간 단가 상승. 손익분해 합산 항.
   */
  maturityEffectAPct: number;
  /** 만기효과 B (%) = 액면/B매수가 − 1. B를 매수단가에 사서 par로 간 단가 상승. 합산 항 */
  maturityEffectBPct: number;
  /**
   * 증분효과 (%) = 총기대수익률 − 만기효과 A − 만기효과 B − 이자효과. 잔여 —
   * 수량이 늘며 생긴 효과(A·B 할인이 서로·쿠폰에 곱해진 교차분) + 선취 + 잔돈.
   */
  incrementEffectPct: number;
  /** 이자효과 (%) = (A쿠폰 + B쿠폰 명목합) ÷ A 보유 액면. 순수 쿠폰수익률(매수가 무관) */
  couponEffectPct: number;
  /** 총 기대수익률 (BRL = KRW, 단일환율, 쿠폰 재투자 없이 명목합, %) */
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
  if (!(fx > 0)) return null; // 환율 0·음수·NaN → 나눗셈 Infinity 방어

  // 현금흐름 탭과 동일: (원금 − 선취신탁보수) → 헤알 환산 → PU로 나눠 정수 좌수만
  // 매수하고, 사고 남은 헤알 잔돈은 무이자로 만기까지 이월한다.
  const frontFeeKrw = Math.trunc(
    input.principalKrw * (input.frontFeeInitialPct / 100)
  );
  const availableBrl = (input.principalKrw - frontFeeKrw) / fx;
  const units = Math.floor(availableBrl / puA);
  if (units <= 0) return null;
  const carryBrl0 = availableBrl - units * puA;

  // 수익률 분모 = 고객이 낸 신탁투자원금(헤알 환산). 현금흐름 탭의 "신탁원금 대비
  // 수익률"과 같은 기준 — 선취신탁보수·A매수단가가 총기대수익률에 제대로 반영되고,
  // 소액 원금에서 잔돈(carryBrl)이 분자에만 잡혀 수익률이 폭주하던 문제가 없어진다.
  // 두 전략이 완전히 동일한 분모를 쓰므로 롤오버 vs 갈아타기가 공정하게 비교된다.
  const investBrl = input.principalKrw / fx;

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
    // A 보유자는 결제일(settleExit)까지 경제적 노출을 갖는다. A 쿠폰 구간을
    // A 청산일(exitDate)이 아니라 결제일까지로 잡아야, 청산일이 비영업일일 때
    // (exitDate, settleExit] 사이 이표일이 A에도 B에도 안 잡혀 증발하지 않는다.
    // exitPriceA(갈아타기는 settleExit 기준 ex-coupon dirty PU)와도 정합.
    const couponsA = nominalCoupons(settle, settleExit, units);
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
      // 총기대수익률 = 만기효과 A + 만기효과 B + 증분효과 + 이자효과 (정확히 합산).
      //  · 만기효과 A = A매도가(롤오버는 액면) ÷ A매수가 − 1 : A 단가 상승
      //  · 만기효과 B = 액면 ÷ B매수가 − 1                  : B 단가 상승 (만기 par 수렴)
      //  · 이자효과   = 받은 쿠폰 ÷ A 보유 액면            : 순수 쿠폰수익률(매수가 무관)
      //  · 증분효과   = 나머지 = A·B 할인이 서로·쿠폰에 곱해진 교차분 + 선취 + 잔돈
      maturityEffectAPct: (exitPriceA / puA - 1) * 100,
      maturityEffectBPct: (FACE / puB - 1) * 100,
      couponEffectPct: ((couponsA + couponsB) / (units * FACE)) * 100,
      incrementEffectPct:
        (totalReturn -
          (exitPriceA / puA - 1) -
          (FACE / puB - 1) -
          (couponsA + couponsB) / (units * FACE)) *
        100,
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
