import {
  computeBondPricing,
  type BondPricingResult,
} from "@/lib/cashflow/bondPricing";
import {
  generateFixCashFlow,
  type CashFlowRow,
  type CashFlowScheduleInputs,
} from "@/lib/cashflow/cashFlowSchedule";
import {
  computeMaturitySummary,
  type MaturitySummary,
} from "@/lib/cashflow/maturitySummary";
import { getInvestmentDays } from "@/lib/cashflow/couponSchedule";
import type { CalcBasis, CouponFrequency, TaxStatus } from "@/lib/cashflow/bondLayout";

/**
 * 신탁 관점 전략 시뮬레이션 — **현금흐름 탭과 같은 엔진**으로 계산한다.
 *
 * 예전 시뮬레이션(`ntnfSimulation.ts`)은 채권 거래만 봐서 후취보수·현금성이자·
 * 세금·환율분리·경과이자의 원금 차감이 빠져 있었고, 그래서 현금흐름 탭과 숫자가
 * 어긋났다. 여기서는 각 구간을 `generateFixCashFlow` + `computeMaturitySummary`
 * 로 돌려 두 탭의 규칙을 하나로 맞춘다(2026-09-17 결정).
 *
 * 전략:
 *  · 만기보유 — 보유종목 A 를 만기까지
 *  · 롤오버   — A 만기상환 → 그 대금으로 B 매수 → B 만기까지 (현금흐름 2회 연결)
 *  · 갈아타기 — A 중도청산 → B 매수 → B 만기까지 (3단계에서 추가)
 *  · 중도해지 — A 중도청산으로 종료 (4단계에서 추가)
 */

export interface TrustSimInput {
  /** 신탁투자원금 (원) */
  principalKrw: number;
  /** 신탁계약일 "YYYY-MM-DD" */
  contractDate: string;
  /** 보유종목 A */
  bondA: { maturityDate: string; purchaseYieldPct: number };
  /** 갈아탈 종목 B (롤오버·갈아타기에서 사용) */
  bondB?: { maturityDate: string; purchaseYieldPct: number };
  /** 선취 신탁보수율 (%) — 최초 매수 */
  frontFeePct: number;
  /** 롤오버·갈아타기 때 새로 떼는 선취보수율 (%) */
  rolloverFrontFeePct: number;
  /** 후취 신탁보수율 (%, 연) */
  backFeePct: number;
  /** 현금성이율 (%, 연) */
  cashInterestPct: number;
  /** 종합소득세율 (%) — 은행환산수익률용 */
  comprehensiveTaxPct: number;
  taxStatus: TaxStatus;
  /** 매수시점환율 (원/헤알) */
  purchaseFxRate: number;
  /** 만기예상환율 (원/헤알) */
  maturityFxRate: number;
  couponRatePct: number;
  couponFrequency: CouponFrequency;
  calcBasis: CalcBasis;
}

/** 한 구간(채권 하나를 사서 만기 또는 중도청산까지)의 결과 */
export interface TrustLeg {
  bondMaturity: string;
  contractDate: string;
  /** 이 구간에 투입한 원금 (원) */
  principalKrw: number;
  pricing: BondPricingResult;
  rows: CashFlowRow[];
  /** 만기까지 보유한 구간만 채워진다 */
  summary: MaturitySummary | null;
  /** 구간 종료 시 회수한 세후 총액 (원) — 다음 구간의 원금이 된다 */
  recoveredKrw: number;
  /** 구간 종료일 (만기보유면 신탁만기일, 중도청산이면 청산 결제일) */
  endDate: string;
}

function baseInputs(
  input: TrustSimInput,
  bond: { maturityDate: string; purchaseYieldPct: number },
  contractDate: string,
  principalKrw: number,
  frontFeePct: number
): CashFlowScheduleInputs {
  return {
    maturityDate: bond.maturityDate,
    couponRate: String(input.couponRatePct),
    couponFrequency: input.couponFrequency,
    purchaseYield: String(bond.purchaseYieldPct),
    calcBasis: input.calcBasis,
    trustContractDate: contractDate,
    recentCouponDate: "",
    trustMaturityDate: "",
    tradeCurrency: "BRL",
    custodyCurrency: "KRW",
    purchaseFxRate: String(input.purchaseFxRate),
    maturityFxRate: String(input.maturityFxRate),
    trustInvestmentAmount: String(principalKrw),
    frontFeeRate: String(frontFeePct),
    backFeeRate: String(input.backFeePct),
    cashInterestRate: String(input.cashInterestPct),
    taxStatus: input.taxStatus,
  };
}

/**
 * 한 구간을 돌린다.
 * @param trustMaturityDate 신탁만기일 수기 지정. 롤오버의 앞 구간처럼 신탁이
 *   계속 이어질 때는 채권 만기일을 그대로 넣어 리드타임(11일)을 0으로 만든다.
 */
function runLeg(
  input: TrustSimInput,
  bond: { maturityDate: string; purchaseYieldPct: number },
  contractDate: string,
  principalKrw: number,
  frontFeePct: number,
  opts?: { trustMaturityDate?: string }
): TrustLeg | null {
  if (!(principalKrw > 0)) return null;
  const cfInput: CashFlowScheduleInputs = {
    ...baseInputs(input, bond, contractDate, principalKrw, frontFeePct),
    ...(opts?.trustMaturityDate ? { trustMaturityDate: opts.trustMaturityDate } : {}),
  };
  const pricing = computeBondPricing({ ...cfInput, reserveRate: "0" });
  const rows = generateFixCashFlow(cfInput);
  if (!pricing || !rows || rows.length === 0) return null;

  const summary = computeMaturitySummary(pricing, rows, {
    trustContractDate: contractDate,
    trustMaturityDate: cfInput.trustMaturityDate,
    maturityDate: bond.maturityDate,
    trustInvestmentAmount: String(principalKrw),
    backFeeRate: String(input.backFeePct),
    tradeCurrency: "BRL",
    custodyCurrency: "KRW",
    maturityFxRate: String(input.maturityFxRate),
    comprehensiveTaxRate: String(input.comprehensiveTaxPct),
  });
  if (!summary) return null;

  return {
    bondMaturity: bond.maturityDate,
    contractDate,
    principalKrw,
    pricing,
    rows,
    summary,
    recoveredKrw: summary.totalReceived,
    endDate: rows[rows.length - 1].date,
  };
}

export interface TrustStrategyResult {
  legs: TrustLeg[];
  /** 최종 회수 세후 총액 (원) */
  totalReceivedKrw: number;
  /** 신탁투자원금 대비 총수익률 (%) */
  totalReturnPct: number;
  /** 복리 환산 수익률 (%) — 전략 전체 기간 기준 */
  cagrPct: number | null;
  /** 전체 투자일수 */
  days: number;
  /** 종료일 */
  endDate: string;
}

function wrap(input: TrustSimInput, legs: TrustLeg[]): TrustStrategyResult | null {
  if (legs.length === 0) return null;
  const last = legs[legs.length - 1];
  const total = last.recoveredKrw;
  const days =
    getInvestmentDays(input.contractDate, last.bondMaturity) ?? 0;
  const ret = total / input.principalKrw - 1;
  return {
    legs,
    totalReceivedKrw: total,
    totalReturnPct: ret * 100,
    cagrPct:
      days > 0 && total > 0
        ? (Math.pow(total / input.principalKrw, 365 / days) - 1) * 100
        : null,
    days,
    endDate: last.endDate,
  };
}

/** ① 만기보유 — A 를 만기까지. 현금흐름 탭 결과와 정확히 같아야 한다. */
export function simulateHold(input: TrustSimInput): TrustStrategyResult | null {
  const leg = runLeg(
    input,
    input.bondA,
    input.contractDate,
    input.principalKrw,
    input.frontFeePct
  );
  return leg ? wrap(input, [leg]) : null;
}

/**
 * ② 롤오버 — A 만기상환 대금으로 B 를 사서 B 만기까지.
 * 앞 구간은 신탁이 이어지므로 신탁만기일 리드타임을 붙이지 않는다
 * (A 만기일에 바로 B 를 산다). 뒤 구간 끝에만 리드타임이 붙는다.
 */
export function simulateRollover(
  input: TrustSimInput
): TrustStrategyResult | null {
  if (!input.bondB) return null;
  if (!(input.bondB.maturityDate > input.bondA.maturityDate)) return null;

  const legA = runLeg(
    input,
    input.bondA,
    input.contractDate,
    input.principalKrw,
    input.frontFeePct,
    { trustMaturityDate: input.bondA.maturityDate } // 리드타임 0
  );
  if (!legA) return null;

  const legB = runLeg(
    input,
    input.bondB,
    input.bondA.maturityDate,
    Math.trunc(legA.recoveredKrw),
    input.rolloverFrontFeePct
  );
  if (!legB) return null;

  // 전체 기간은 최초 계약일 ~ B 신탁만기일
  const days = getInvestmentDays(input.contractDate, input.bondB.maturityDate) ?? 0;
  const total = legB.recoveredKrw;
  const ret = total / input.principalKrw - 1;
  return {
    legs: [legA, legB],
    totalReceivedKrw: total,
    totalReturnPct: ret * 100,
    cagrPct:
      days > 0 && total > 0
        ? (Math.pow(total / input.principalKrw, 365 / days) - 1) * 100
        : null,
    days,
    endDate: legB.endDate,
  };
}
