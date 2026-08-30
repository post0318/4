/**
 * NTN-F 시나리오 시뮬레이션 — 특정 종목을 매수한 뒤
 *  ① 중도해지            : 만기 전 매도
 *  ② 중도해지 후 갈아타기 : 만기 전 매도 → 다른 종목 매수 → 그 종목 만기까지 보유
 *  ③ 만기해지 후 롤오버   : 만기까지 보유 → 다른 종목 매수 → 그 종목 만기까지 보유
 * ②·③은 항상 같은 종료시점(갈아탈 종목 B의 만기)에서 비교한다.
 *
 * 수익률은 헤알(BRL)·원화(KRW) 두 기준으로 내고, 원화 수익률을
 *  자본소득 / 이자소득 / 환율소득 기여도로 분해한다(누적 %p, 합 = 원화 누적수익률).
 *
 * 단순화 가정: 쿠폰은 받은 시점의 해당 종목 금리(매수금리 + 평행이동 Δ)로 종료
 * 시점까지 재투자한다. 매도·재투자 단가도 "매수금리 + Δ"로 계산한다.
 */

import { brazilBusinessDaysBetween } from "@/lib/brazilCalendar";
import {
  computeNtnfPu,
  getOrderSettlementDate,
  parseLocalDate,
  toISODate,
  today,
} from "@/lib/ntnfPricing";

const FACE = 1000;
const COUPON = FACE * (Math.pow(1.1, 0.5) - 1); // 반기 실효쿠폰 ≈ 48.8088
const BD_YEAR = 252;

export interface Leg {
  /** 만기 "YYYY-MM-DD" */
  maturity: string;
  /** 매수수익률 (연 %) */
  yieldPct: number;
}

export interface SimInput {
  /** 종목 A (지금 매수) */
  bond: Leg;
  /** 종목 B (갈아타기·롤오버 대상) */
  target: Leg;
  /** 중도해지 시점 "YYYY-MM-DD" */
  exitDate: string;
  /** 매수 시 BRL→KRW 환율 */
  buyFx: number;
  /** 회수 시 BRL→KRW 환율 (기본 = 매수 환율) */
  exitFx: number;
  /** 평행 금리 이동 Δ (%p) — 매도·재투자 금리에 가산 */
  shiftPct: number;
}

export interface Scenario {
  key: "exit" | "switch" | "rollover";
  label: string;
  /** 종료 시점 "YYYY-MM-DD" */
  endDate: string;
  years: number;
  annualBrlPct: number;
  annualKrwPct: number;
  totalKrwPct: number;
  /** 누적 기여도 (%p, 합 ≈ totalKrwPct) */
  capitalPct: number;
  couponPct: number;
  fxPct: number;
}

export interface SimResult {
  exit: Scenario | null;
  switch: Scenario | null;
  rollover: Scenario | null;
  settlement: string;
}

/** start 초과 ~ end 이하의 이표일(1/1·7/1) 목록 */
function couponDatesBetween(start: Date, end: Date): Date[] {
  const out: Date[] = [];
  for (let y = start.getFullYear() - 1; y <= end.getFullYear() + 1; y++) {
    for (const m of [0, 6]) {
      const d = new Date(y, m, 1);
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
  const mat = parseLocalDate(maturity);
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

/** 누적 BRL 손익을 통화·기여도로 분해해 시나리오로 만든다 */
function build(
  key: Scenario["key"],
  label: string,
  puBuy: number,
  principalEnd: number,
  couponsBrl: number,
  settle: Date,
  end: Date,
  input: SimInput
): Scenario {
  const capital = (principalEnd - puBuy) / puBuy;
  const coupon = couponsBrl / puBuy;
  const rBrl = capital + coupon;
  const rFx = input.exitFx / input.buyFx - 1;
  const fx = rFx * (1 + rBrl);
  const rKrw = (1 + rBrl) * (1 + rFx) - 1;
  const t = Math.max(years(settle, end), 1 / 365);
  return {
    key,
    label,
    endDate: toISODate(end),
    years: t,
    annualBrlPct: (Math.pow(1 + rBrl, 1 / t) - 1) * 100,
    annualKrwPct: (Math.pow(1 + rKrw, 1 / t) - 1) * 100,
    totalKrwPct: rKrw * 100,
    capitalPct: capital * 100,
    couponPct: coupon * 100,
    fxPct: fx * 100,
  };
}

export function simulate(input: SimInput): SimResult {
  const settle = getOrderSettlementDate(today());
  const settleIso = toISODate(settle);
  const matA = parseLocalDate(input.bond.maturity);
  const matB = parseLocalDate(input.target.maturity);
  const exit = parseLocalDate(input.exitDate);
  const empty: SimResult = {
    exit: null,
    switch: null,
    rollover: null,
    settlement: settleIso,
  };
  if (!matA || !matB || !exit) return empty;

  const puBuyA = computeNtnfPu(input.bond.maturity, input.bond.yieldPct, settle);
  if (puBuyA == null) return empty;

  const yA = input.bond.yieldPct + input.shiftPct;
  const yB = input.target.yieldPct + input.shiftPct;

  // A를 시점 S에 처분했을 때의 원금부분(매도단가 또는 액면). 불가 시 null.
  const principalA = (s: Date): number | null => {
    if (s >= matA) return FACE;
    const pu = computeNtnfPu(input.bond.maturity, yA, getOrderSettlementDate(s));
    return pu == null || pu <= 0 ? null : pu;
  };

  // ── ① 중도해지 ──────────────────────────────────────────────
  let exitScenario: Scenario | null = null;
  if (exit > settle && exit < matA) {
    const p = principalA(exit);
    if (p != null) {
      exitScenario = build(
        "exit",
        "중도해지",
        puBuyA,
        p,
        couponsFV(settle, exit, exit, yA),
        settle,
        exit,
        input
      );
    }
  }

  // ② 갈아타기 / ③ 롤오버 — S에서 A 청산 → B 매수 → B 만기까지
  const twoLeg = (
    key: "switch" | "rollover",
    label: string,
    s: Date
  ): Scenario | null => {
    if (!(matB > s)) return null;
    const pA = principalA(s);
    if (pA == null) return null;
    const settleS = getOrderSettlementDate(s);
    const puBbuy = computeNtnfPu(input.target.maturity, yB, settleS);
    if (puBbuy == null || puBbuy <= 0) return null;
    const unitsB = pA / puBbuy; // A 1 título 기준 B 좌수
    // A 쿠폰: S까지 받아 matB까지 yA로 재투자 / B 쿠폰: S~matB, yB로 재투자
    const couponsBrl =
      couponsFV(settle, s, matB, yA) + unitsB * couponsFV(settleS, matB, matB, yB);
    return build(
      key,
      label,
      puBuyA,
      unitsB * FACE,
      couponsBrl,
      settle,
      matB,
      input
    );
  };

  const switchScenario =
    exit > settle && exit < matA
      ? twoLeg("switch", "중도해지 후 갈아타기", exit)
      : null;
  const rolloverScenario = twoLeg("rollover", "만기해지 후 롤오버", matA);

  return {
    exit: exitScenario,
    switch: switchScenario,
    rollover: rolloverScenario,
    settlement: settleIso,
  };
}

/** 금리 이동 Δ를 훑어 갈아타기·롤오버 연환산 원화수익률 곡선을 만든다 (차트용) */
export function sweepShift(
  input: SimInput,
  from = -3,
  to = 3,
  step = 0.25
): { shift: number; switchKrw: number | null; rolloverKrw: number | null }[] {
  const out: {
    shift: number;
    switchKrw: number | null;
    rolloverKrw: number | null;
  }[] = [];
  for (let d = from; d <= to + 1e-9; d += step) {
    const r = simulate({ ...input, shiftPct: Math.round(d * 100) / 100 });
    out.push({
      shift: Math.round(d * 100) / 100,
      switchKrw: r.switch?.annualKrwPct ?? null,
      rolloverKrw: r.rollover?.annualKrwPct ?? null,
    });
  }
  return out;
}

// ───────────────────────────────────────────────────────────────────
// 롤오버 vs 갈아타기 — "채권 보유수량" 관점 비교
//  ① 롤오버   : 보유종목 A 만기상환 → 대금으로 B 신규매수 → B 만기까지 보유
//  ② 갈아타기 : A 중도매도 → 대금으로 B 신규매수 → B 만기까지 보유
// 두 전략 모두 B 만기에 종료. 핵심 지표는 "신규매수수량 / 기존수량" 증분효과.
// 쿠폰은 재투자하지 않고 명목 합산. 환율은 단일값(매수=회수).
// ───────────────────────────────────────────────────────────────────

export interface RollSwitchInput {
  /** 채권 보유수량 (좌, 액면 R$1,000) */
  units: number;
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
  /** 롤오버 선취수수료 (%) */
  frontFeeRollPct: number;
  /** 갈아타기 선취수수료 (%) */
  frontFeeSwitchPct: number;
  /** A 매도가격 직접 지정 (R$, per 좌). 없으면 sellYieldA로 계산 */
  overrideSellPriceA?: number | null;
  /** B 매수가격 직접 지정 (R$, per 좌). 없으면 buyYieldB로 계산 */
  overrideBuyPriceB?: number | null;
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
  /** 총 기대수익률 (BRL, 쿠폰 포함, %) */
  totalReturnPct: number;
  /** 총 기대수익률 (KRW, %) — 단일환율이라 BRL과 동일 */
  totalReturnKrwPct: number;
  /** 최초 투자금액(원), 최종 회수금액(원) */
  investKrw: number;
  finalKrw: number;
}

export interface RollSwitchResult {
  rollover: RollSwitchLeg | null;
  switch: RollSwitchLeg | null;
  /** A 최초 매수단가 (R$) */
  buyPriceA: number;
}

function nominalCoupons(from: Date, to: Date, units: number): number {
  return units * couponsFV(from, to, to, 0);
}

export function simulateRollVsSwitch(
  input: RollSwitchInput
): RollSwitchResult | null {
  const settle = getOrderSettlementDate(today());
  const matA = parseLocalDate(input.bondA.maturity);
  const matB = parseLocalDate(input.bondB.maturity);
  const sell = parseLocalDate(input.sellDate);
  if (!matA || !matB || !sell) return null;

  const puA = computeNtnfPu(input.bondA.maturity, input.bondA.buyYieldPct, settle);
  if (puA == null || puA <= 0) return null;
  const investBrl = input.units * puA;
  const fx = input.fxKrwPerBrl;

  const leg = (
    key: "rollover" | "switch",
    label: string,
    exitDate: Date,
    exitPriceA: number,
    frontFeePct: number
  ): RollSwitchLeg | null => {
    if (!(matB > exitDate)) return null;
    const settleExit = getOrderSettlementDate(exitDate);
    const puB =
      input.overrideBuyPriceB != null && input.overrideBuyPriceB > 0
        ? input.overrideBuyPriceB
        : computeNtnfPu(input.bondB.maturity, input.buyYieldB, settleExit);
    if (puB == null || puB <= 0) return null;

    const proceeds = input.units * exitPriceA * (1 - frontFeePct / 100);
    const unitsEnd = Math.floor(proceeds / puB);
    const couponsA = nominalCoupons(settle, exitDate, input.units);
    const couponsB = nominalCoupons(settleExit, matB, unitsEnd);
    const finalBrl = unitsEnd * FACE + couponsA + couponsB;

    const totalReturn = finalBrl / investBrl - 1;
    return {
      key,
      label,
      exitDate: toISODate(exitDate),
      endDate: toISODate(matB),
      years: Math.max(years(settle, matB), 1 / 365),
      exitPriceA,
      buyPriceB: puB,
      unitsStart: input.units,
      unitsEnd,
      incrementPct: (unitsEnd / input.units - 1) * 100,
      maturityEffectAPct: (exitPriceA / puA - 1) * 100,
      maturityEffectBPct: (FACE / puB - 1) * 100,
      totalReturnPct: totalReturn * 100,
      totalReturnKrwPct: totalReturn * 100,
      investKrw: investBrl * fx,
      finalKrw: finalBrl * fx,
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

  return { rollover, switch: switchLeg, buyPriceA: puA };
}
