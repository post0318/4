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
