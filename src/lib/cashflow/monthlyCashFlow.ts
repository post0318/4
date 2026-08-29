import {
  CouponFrequency,
  Currency,
  CalcBasis,
  TaxStatus,
} from "@/lib/cashflow/bondLayout";
import {
  FREQUENCY_MONTHS,
  addMonths,
  getInvestmentDays,
} from "@/lib/cashflow/couponSchedule";
import { computeBondPricing, roundDown } from "@/lib/cashflow/bondPricing";
import { CASH_INTEREST_TAX_RATE } from "@/lib/cashflow/taxRules";
import { koreaPaymentDate } from "@/lib/cashflow/koreaCalendar";

export type MonthlyRowType = "월지급" | "만기상환";

export interface MonthlyCashFlowRow {
  date: string;
  type: MonthlyRowType;
  /** 경과이자차감 원금 잔액 (그 회차 반영 후). 표에는 표시 안 하고 요약용 */
  principalBalance: number;
  /** 보유현금 잔액 (그 회차 반영 후) */
  cashBalance: number;
  /** 월지급액 (만기상환 행은 청산 지급액). 표에는 표시 안 함 */
  payout: number;
  /** 표의 "원금" 열: 월지급 회차는 원금 나간 분(음수), 만기상환 행은 원금수령분(양수) */
  principalDelta: number;
  /** "채권이자" 열: 그 반기에 수령한 쿠폰 총액(사이클 첫 회차 + 만기상환에만). 월분할액 아님 */
  bondInterest: number;
  /** 그 구간 보유현금 현금성이자 (과세 대상 소득) */
  cashInterest: number;
  /** 과세소득 = 채권이자(반기 수령분) + 현금이자. 채권이자는 비과세라 과세표준엔 안 들어감 */
  taxableIncome: number;
  /** 과세표준 = 현금이자 − 선취/후취보수 공제(잔여) */
  taxBase: number;
  /** 소득세 = 과세표준 × 15.4% */
  incomeTax: number;
  /** 세후수령액 = 월지급액 − 소득세 */
  netAmount: number;
}

export interface MonthlyCashFlowInputs {
  maturityDate: string;
  couponRate: string;
  couponFrequency: CouponFrequency;
  purchaseYield: string;
  calcBasis: CalcBasis;
  trustContractDate: string;
  recentCouponDate: string;
  tradeCurrency: Currency;
  custodyCurrency: Currency;
  purchaseFxRate: string;
  maturityFxRate: string;
  trustInvestmentAmount: string;
  frontFeeRate: string;
  backFeeRate: string;
  cashInterestRate: string;
  reserveRate: string;
  taxStatus: TaxStatus;
  /** 은행환산수익률 계산용 종합소득세율(%) */
  comprehensiveTaxRate: string;
}

/** 월지급 요약 (반기의 computeMaturitySummary와 같은 필드 이름으로 맞춤) */
export interface MonthlyCashFlowSummary {
  /** 경과이자차감 원금 = 만기 직전 원금 잔액 */
  investedPrincipal: number;
  /** 지급이자 총액 = 채권쿠폰 합계 + 현금이자 합계 */
  totalInterest: number;
  /** 만기시 세후금액 = 신탁만기일 청산 세후수령액 */
  postTaxMaturityAmount: number;
  /** 세후수익률 = (투자자 총수령 − 신탁투자금액) / 신탁투자금액 × 365/투자일수 */
  postTaxYield: number;
  bankEquivalentYield: number;
}

export interface MonthlyCashFlowResult {
  rows: MonthlyCashFlowRow[];
  summary: MonthlyCashFlowSummary;
}

const TRUST_MATURITY_LEAD_DAYS = 11;
const DEFAULT_COMPREHENSIVE_TAX_RATE = 0.154;

function daysBetween(a: Date, b: Date): number {
  return Math.round((b.getTime() - a.getTime()) / 86_400_000);
}

function toTime(d: Date): number {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

type Event =
  | { date: Date; kind: "쿠폰수령" }
  | { date: Date; kind: "월지급"; cycleIndex: number; monthInCycle: number }
  | { date: Date; kind: "만기상환" };

/**
 * 월지급(반기쿠폰을 6개월 분할) 현금흐름.
 * - 가입 시 유보율만큼 현금 확보(computeBondPricing에서 매수가능금액 차감).
 * - 첫 쿠폰 전(Phase 1): 유보현금에서 매월 10일 지급. 원금분은 비과세, 원금 잔액 차감.
 * - 쿠폰 수령 후(Phase 2): 쿠폰을 6개월 분할 지급. 지급액은 현금이자분 → 채권이자분
 *   → (첫 쿠폰만) 경과이자분 순으로 충당. 경과이자분만 원금 잔액 차감.
 * - 매 회차 과세: 그 구간 현금성이자 × 15.4% (선취/후취보수 공제 반영).
 * - 만기: 마지막 쿠폰은 분할하지 않고 신탁만기일에 원금상환·잔여현금과 함께 청산 지급.
 */
export function generateMonthlyCashFlow(
  input: MonthlyCashFlowInputs
): MonthlyCashFlowResult | null {
  const pricing = computeBondPricing(input);
  if (!pricing) return null;

  const maturity = new Date(input.maturityDate);
  const contract = new Date(input.trustContractDate);
  const settlement = new Date(pricing.settlementDate);
  if (Number.isNaN(maturity.getTime()) || Number.isNaN(contract.getTime())) {
    return null;
  }

  const needsFx = input.tradeCurrency !== input.custodyCurrency;
  const maturityFx = needsFx ? Number(input.maturityFxRate) : 1;
  if (needsFx && (!maturityFx || Number.isNaN(maturityFx) || maturityFx <= 0)) {
    return null;
  }
  const isKrw = input.custodyCurrency === "KRW";
  const trunc = (n: number) => (isKrw ? Math.trunc(n) : roundDown(n, 2));

  const months = FREQUENCY_MONTHS[input.couponFrequency];
  const freqPerYear = 12 / months;
  const paymentsPerCycle = months; // 6개월 지급주기 → 6회
  const rate = Number(input.couponRate) / 100;
  const cashRate = Number(input.cashInterestRate) || 0;
  const backFeeRate = Number(input.backFeeRate);
  const trustAmount = Number(input.trustInvestmentAmount);
  const frontFeeAmount = Math.trunc(trustAmount * (Number(input.frontFeeRate) / 100));
  if (Number.isNaN(backFeeRate) || Number.isNaN(trustAmount)) return null;

  // 쿠폰액 (브라질은 복리환산 반기쿠폰). 액면통화 기준으로 구한 뒤 수탁통화로
  // 환산하고 절사해 정수 KRW로 만든다(월 분할 시 소수점이 새지 않도록).
  const semiCouponFace =
    input.calcBasis === "Business/252"
      ? pricing.faceValue * (Math.pow(1 + rate, 1 / freqPerYear) - 1)
      : (rate * pricing.faceValue) / freqPerYear;
  const semiCoupon = trunc(roundDown(semiCouponFace, 2) * maturityFx);
  const principalRedemption = trunc(pricing.faceValue * maturityFx);
  const preOwnedInterest = trunc(
    semiCoupon * pricing.accrualFraction * freqPerYear
  );
  const monthlyPayout = trunc(semiCoupon / paymentsPerCycle);
  const lastPayout = trunc(semiCoupon - monthlyPayout * (paymentsPerCycle - 1));

  // 쿠폰일 목록 (결제일 이후 첫 이표일 ~ 만기)
  const couponDates: Date[] = [];
  let cursor = addMonths(new Date(pricing.recentCouponDate), months);
  while (cursor <= maturity) {
    couponDates.push(new Date(cursor));
    if (toTime(cursor) === toTime(maturity)) break;
    cursor = addMonths(cursor, months);
  }
  if (couponDates.length === 0) return null;
  const firstCoupon = couponDates[0];
  const trustMaturity = new Date(maturity);
  trustMaturity.setDate(trustMaturity.getDate() + TRUST_MATURITY_LEAD_DAYS);

  // ── 이벤트 타임라인 ──
  const events: Event[] = [];
  // Phase 1: 계약일이 속한 달(계약일 10일 이후면 익월)부터 첫 쿠폰 전까지 매월 10일
  let m = new Date(contract.getFullYear(), contract.getMonth(), 1);
  if (contract.getDate() > 10) m = addMonths(m, 1);
  while (m < firstCoupon) {
    const pd = koreaPaymentDate(m.getFullYear(), m.getMonth());
    if (pd >= settlement && pd < firstCoupon) {
      events.push({ date: pd, kind: "월지급", cycleIndex: -1, monthInCycle: -1 });
    }
    m = addMonths(m, 1);
  }
  // Phase 2: 각 쿠폰마다 수령 + 6회 월지급. 만기쿠폰은 분할하지 않고 신탁만기일
  // 청산 때 원금상환과 함께 지급하므로 여기서 다루지 않는다.
  couponDates.forEach((cd, ci) => {
    if (toTime(cd) === toTime(maturity)) return;
    events.push({ date: cd, kind: "쿠폰수령" });
    for (let k = 0; k < paymentsPerCycle; k++) {
      const mm = addMonths(new Date(cd.getFullYear(), cd.getMonth(), 1), k);
      const pd = koreaPaymentDate(mm.getFullYear(), mm.getMonth());
      events.push({ date: pd, kind: "월지급", cycleIndex: ci, monthInCycle: k });
    }
  });
  events.push({ date: trustMaturity, kind: "만기상환" });
  events.sort((a, b) => a.date.getTime() - b.date.getTime());

  // ── 상태 ──
  let held = pricing.reserveAmount + pricing.cashBalance; // 보유현금
  let principalLedger = trustAmount; // 경과이자차감 원금
  let prev = settlement;
  let carryFrontFee = frontFeeAmount;
  let carryBackFeeResidual = 0;
  let firstCouponReceived = false;
  let remainingRealInterest = 0; // 첫 쿠폰 실이자분 잔여
  let remainingPreOwned = 0; // 첫 쿠폰 경과이자분 잔여
  const rows: MonthlyCashFlowRow[] = [];

  const roundTax = (n: number) => (isKrw ? roundDown(n, -1) : roundDown(n, 2));

  for (const ev of events) {
    const days = daysBetween(prev, ev.date);
    const cashInterest = trunc(
      (held * (cashRate / 100)) / 365 * Math.max(0, days)
    );
    held += cashInterest;

    if (ev.kind === "쿠폰수령") {
      held += semiCoupon;
      if (!firstCouponReceived) {
        firstCouponReceived = true;
        remainingPreOwned = preOwnedInterest;
        remainingRealInterest = semiCoupon - preOwnedInterest;
      } else {
        remainingRealInterest += semiCoupon;
      }
      prev = ev.date;
      continue;
    }

    // 선취/후취보수 공제 (반기와 동일 로직)
    const backFeeThisPeriod =
      ((trustAmount * (backFeeRate / 100)) / 365) * Math.max(0, days);
    const totalDeduction = carryFrontFee + carryBackFeeResidual + backFeeThisPeriod;

    let payout = 0;
    let principalDelta = 0;
    let bondInterest = 0;

    if (ev.kind === "월지급") {
      const isLastInCycle =
        ev.monthInCycle === paymentsPerCycle - 1;
      payout = ev.cycleIndex === -1
        ? monthlyPayout
        : isLastInCycle
          ? lastPayout
          : monthlyPayout;

      const cashIncomePart = Math.min(payout, Math.max(0, cashInterest));
      let remainder = payout - cashIncomePart;

      if (ev.cycleIndex === -1) {
        // Phase 1: 나머지는 유보(원금)에서. 원금 잔액 차감.
        principalDelta = -remainder;
        principalLedger += principalDelta;
      } else {
        // Phase 2: 선 이자(현금이자분→채권이자분) 후 경과이자(원금차감)
        const realIntPart = Math.min(remainder, Math.max(0, remainingRealInterest));
        remainingRealInterest -= realIntPart;
        remainder -= realIntPart;
        // "채권이자" 열은 그 반기에 수령한 쿠폰 총액을 사이클 첫 회차에 한 번 표시.
        // 월별로 나눠 지급되는 금액이 아니라 반기 수령액이다.
        if (ev.monthInCycle === 0) bondInterest = semiCoupon;
        const preOwnedPart = Math.min(remainder, Math.max(0, remainingPreOwned));
        remainingPreOwned -= preOwnedPart;
        remainder -= preOwnedPart;
        principalDelta = -preOwnedPart;
        principalLedger += principalDelta;
      }
      held -= payout;

      const taxBase = trunc(
        cashIncomePart > totalDeduction ? cashIncomePart - totalDeduction : 0
      );
      const incomeTax = roundTax(taxBase * CASH_INTEREST_TAX_RATE);
      const netAmount = trunc(payout - incomeTax);

      rows.push({
        date: ev.date.toISOString().slice(0, 10),
        type: "월지급",
        principalBalance: trunc(principalLedger),
        cashBalance: trunc(held),
        payout,
        principalDelta,
        bondInterest,
        cashInterest,
        taxableIncome: bondInterest + cashInterest,
        taxBase,
        incomeTax,
        netAmount,
      });

      // 공제 이월: 실제 과세되는 소득(현금이자)만큼만 소진. 비과세 채권이자는
      // 공제를 갉아먹지 않는다(선취보수가 첫 회차에 소각되던 문제).
      const availableBackFee = carryBackFeeResidual + backFeeThisPeriod;
      const deductionUsed = Math.min(totalDeduction, cashInterest);
      const frontUsed = Math.min(carryFrontFee, deductionUsed);
      carryFrontFee -= frontUsed;
      carryBackFeeResidual = availableBackFee - (deductionUsed - frontUsed);
      prev = ev.date;
      continue;
    }

    if (ev.kind === "만기상환") {
      held += semiCoupon + principalRedemption; // 마지막 쿠폰 + 원금상환 (분할 안 함)
      payout = trunc(held);
      // 만기상환 행은 원금을 "수령"한다 → 양수. 금액 = 상환 액면 × 만기환율
      // (경과이자차감 원금 잔액이 아님). 반기표의 원금 열과 같은 취급.
      principalDelta = principalRedemption;
      principalLedger = 0;
      held = 0;
      bondInterest = semiCoupon; // 만기에 받는 마지막 반기쿠폰

      const taxBase = trunc(
        cashInterest > totalDeduction ? cashInterest - totalDeduction : 0
      );
      const incomeTax = roundTax(taxBase * CASH_INTEREST_TAX_RATE);
      const netAmount = trunc(payout - incomeTax);

      rows.push({
        date: ev.date.toISOString().slice(0, 10),
        type: "만기상환",
        principalBalance: 0,
        cashBalance: 0,
        payout,
        principalDelta,
        bondInterest,
        cashInterest,
        taxableIncome: bondInterest + cashInterest,
        taxBase,
        incomeTax,
        netAmount,
      });
      prev = ev.date;
    }
  }

  // ── 요약 ──
  const monthlyRows = rows.filter((r) => r.type === "월지급");
  const investedPrincipal =
    monthlyRows.length > 0
      ? monthlyRows[monthlyRows.length - 1].principalBalance
      : trustAmount;
  const totalBondCoupon = semiCoupon * couponDates.length;
  const totalCashInterest = rows.reduce((s, r) => s + r.cashInterest, 0);
  const maturityRow = rows.find((r) => r.type === "만기상환");
  const postTaxMaturityAmount = maturityRow ? maturityRow.netAmount : 0;
  const totalReceived = rows.reduce((s, r) => s + r.netAmount, 0);

  const investmentDays =
    getInvestmentDays(input.trustContractDate, input.maturityDate) ?? 0;
  const postTaxYield =
    investmentDays > 0
      ? ((totalReceived - trustAmount) / trustAmount) * (365 / investmentDays)
      : 0;
  const parsedComprehensive = Number(input.comprehensiveTaxRate);
  const comprehensiveTaxRate =
    input.comprehensiveTaxRate && !Number.isNaN(parsedComprehensive)
      ? parsedComprehensive / 100
      : DEFAULT_COMPREHENSIVE_TAX_RATE;

  const summary: MonthlyCashFlowSummary = {
    investedPrincipal,
    totalInterest: totalBondCoupon + totalCashInterest,
    postTaxMaturityAmount,
    postTaxYield,
    bankEquivalentYield: postTaxYield / (1 - comprehensiveTaxRate),
  };

  return { rows, summary };
}
