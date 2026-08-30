/**
 * 재투자형 현금흐름 — 수령한 쿠폰(BRL)으로 같은 채권을 재매수한다.
 *
 * 가정:
 * - 재투자 시 매수금리 = 최초 매수금리(purchaseYield) 그대로.
 * - 정수 좌수(액면 R$1,000)만 매수하고, 남는 BRL은 그대로 보유해 다음 재투자에 쓴다.
 * - BRL 보유현금에는 현금성이자가 없다.
 * - 원화(KRW) 금액은 만기에 전액 회수할 때만 발생(중간 회차는 전부 BRL).
 * - 마지막 쿠폰은 재투자하지 않고 만기 상환액과 함께 수령.
 */

import { CalcBasis, CouponFrequency, TaxStatus } from "@/lib/cashflow/bondLayout";
import {
  FREQUENCY_MONTHS,
  FREQUENCY_PER_YEAR,
  addMonths,
  getInvestmentDays,
} from "@/lib/cashflow/couponSchedule";
import { computeBondPricing, roundDown } from "@/lib/cashflow/bondPricing";
import { computeNtnfPu, parseLocalDate, toISODate } from "@/lib/ntnfPricing";
import { getEffectiveIncomeTaxRate } from "@/lib/cashflow/taxRules";

const FACE = 1000;

export interface ReinvestCashFlowRow {
  date: string;
  /** 이번 회차 직전 보유 좌수 */
  unitsBefore: number;
  /** 이번 회차 직전 보유 현금 (BRL) — 전기 재투자 후 남은 잔돈 */
  cashBrlBefore: number;
  /** 이번 회차 쿠폰 (BRL, per 전체 보유분) */
  couponBrl: number;
  /** 재매수 단가 (PU, R$) — 만기 회차는 상환가 1,000 */
  reinvestPu: number;
  /** 이번 회차 추가 매수 좌수 */
  unitsBought: number;
  /** 회차 반영 후 누적 보유 좌수 */
  unitsAfter: number;
  /** 재매수 후 남은 BRL 현금 */
  cashBrl: number;
  /** 만기 회차: 원화 회수액(원금상환 + 마지막 쿠폰 + 잔여현금, 세전, 후취보수 차감) */
  maturityKrw?: number;
}

export interface ReinvestCashFlowInputs {
  maturityDate: string;
  couponRate: string;
  couponFrequency: CouponFrequency;
  purchaseYield: string;
  calcBasis: CalcBasis;
  trustContractDate: string;
  recentCouponDate: string;
  tradeCurrency: string;
  custodyCurrency: string;
  purchaseFxRate: string;
  maturityFxRate: string;
  trustInvestmentAmount: string;
  frontFeeRate: string;
  backFeeRate: string;
  taxStatus: TaxStatus;
  /** 은행환산수익률용 종합소득세율(%) */
  comprehensiveTaxRate: string;
}

export interface ReinvestCashFlowSummary {
  /** 만기 보유 좌수 */
  finalUnits: number;
  /** 재투자로 늘어난 좌수 (만기 − 최초) */
  addedUnits: number;
  /** 수령 쿠폰 총액 (BRL, 재투자분 포함) */
  totalCouponBrl: number;
  /** 세전 만기 회수액 (KRW) */
  preTaxMaturityKrw: number;
  /** 세후 만기 회수액 (KRW) */
  postTaxMaturityKrw: number;
  /** 세후수익률 (단리, 365/투자일수) */
  postTaxYield: number;
  bankEquivalentYield: number;
  /** 후취보수 산출: 신탁투자금액 × 요율 ÷ 365 × 투자일수 (만기 회수 시 차감) */
  backFee: {
    base: number; // 신탁투자금액 (KRW)
    ratePct: number; // 후취보수율 (%)
    days: number; // 투자일수
    amount: number; // 후취보수 금액 (KRW)
  };
}

export interface ReinvestCashFlowResult {
  rows: ReinvestCashFlowRow[];
  summary: ReinvestCashFlowSummary;
  /** 최초 매수 좌수 */
  initialUnits: number;
  /** 최초 매수단가(PU, R$) */
  initialPu: number;
}

function toTime(d: Date): number {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

export function generateReinvestCashFlow(
  input: ReinvestCashFlowInputs
): ReinvestCashFlowResult | null {
  const pricing = computeBondPricing(input);
  if (!pricing) return null;

  const maturity = parseLocalDate(input.maturityDate);
  const settlement = parseLocalDate(pricing.settlementDate);
  if (!maturity || !settlement || settlement >= maturity) return null;

  const rate = Number(input.couponRate) / 100;
  const yld = Number(input.purchaseYield);
  const backFeeRate = Number(input.backFeeRate);
  const trustAmount = Number(input.trustInvestmentAmount);
  if (Number.isNaN(rate) || Number.isNaN(yld) || Number.isNaN(backFeeRate)) {
    return null;
  }

  const needsFx = input.tradeCurrency !== input.custodyCurrency;
  const maturityFx = needsFx ? Number(input.maturityFxRate) : 1;
  const purchaseFx = needsFx ? Number(input.purchaseFxRate) : 1;
  if (needsFx && (!maturityFx || Number.isNaN(maturityFx) || maturityFx <= 0)) {
    return null;
  }
  if (needsFx && (!purchaseFx || Number.isNaN(purchaseFx) || purchaseFx <= 0)) {
    return null;
  }

  const months = FREQUENCY_MONTHS[input.couponFrequency];
  const f = FREQUENCY_PER_YEAR[input.couponFrequency];
  const couponFactor =
    input.calcBasis === "Business/252"
      ? Math.pow(1 + rate, 1 / f) - 1
      : rate / f;

  // 이표일: 결제일 이후 첫 이표일 ~ 만기 (날짜만 비교 — 시각차로 만기가 빠지지 않도록)
  const dates: Date[] = [];
  const recentCoupon =
    parseLocalDate(pricing.recentCouponDate) ??
    new Date(pricing.recentCouponDate);
  let cursor = addMonths(recentCoupon, months);
  while (toTime(cursor) <= toTime(maturity)) {
    dates.push(new Date(cursor));
    if (toTime(cursor) === toTime(maturity)) break;
    cursor = addMonths(cursor, months);
  }
  if (dates.length === 0) return null;

  let units = Math.round(pricing.faceValue / FACE); // 최초 좌수
  const initialUnits = units;
  // 매수 후 남은 현금잔액(원화 표시)은 BRL로 전환해 첫 재투자 재원으로 쓴다.
  let cashBrl = needsFx ? pricing.cashBalance / purchaseFx : pricing.cashBalance;
  let totalCouponBrl = 0;
  const rows: ReinvestCashFlowRow[] = [];

  dates.forEach((date) => {
    const isMaturity = toTime(date) === toTime(maturity);
    const unitsBefore = units;
    const cashBrlBefore = cashBrl; // 이번 회차 쿠폰 반영 전 잔여현금
    const couponBrl = units * FACE * couponFactor;
    totalCouponBrl += couponBrl;

    if (isMaturity) {
      // 마지막 쿠폰 + 원금상환 + 잔여현금 → 원화 회수 (만기엔 재매수 없음)
      const redemptionBrl = units * FACE;
      const grossBrl = redemptionBrl + couponBrl + cashBrl;
      const days = getInvestmentDays(input.trustContractDate, input.maturityDate) ?? 0;
      const backFee =
        (trustAmount * (backFeeRate / 100) / 365) * days; // KRW, 전 기간 후취보수
      const maturityKrw = roundDown(grossBrl * maturityFx - backFee, 2);

      rows.push({
        date: toISODate(date),
        unitsBefore,
        cashBrlBefore: roundDown(cashBrlBefore, 2),
        couponBrl,
        reinvestPu: 0,
        unitsBought: 0,
        unitsAfter: units,
        cashBrl: 0,
        maturityKrw,
      });
      return;
    }

    // 재투자: 쿠폰 + 잔여현금으로 정수 좌수 매수 (매수금리 = 최초 그대로)
    cashBrl += couponBrl;
    const pu = computeNtnfPu(input.maturityDate, yld, date);
    if (pu == null || pu <= 0) {
      rows.push({
        date: toISODate(date),
        unitsBefore,
        cashBrlBefore: roundDown(cashBrlBefore, 2),
        couponBrl,
        reinvestPu: 0,
        unitsBought: 0,
        unitsAfter: units,
        cashBrl: roundDown(cashBrl, 2),
      });
      return;
    }
    const bought = Math.floor(cashBrl / pu);
    cashBrl -= bought * pu;
    units += bought;

    rows.push({
      date: toISODate(date),
      unitsBefore,
      cashBrlBefore: roundDown(cashBrlBefore, 2),
      couponBrl,
      reinvestPu: pu,
      unitsBought: bought,
      unitsAfter: units,
      cashBrl: roundDown(cashBrl, 2),
    });
  });

  const maturityRow = rows[rows.length - 1];
  const preTaxMaturityKrw = maturityRow.maturityKrw ?? 0;

  // 채권이자 과세분(일반과세면 14%). 브라질 국채이자는 비과세 조약이면 0.
  const bondTaxRate = getEffectiveIncomeTaxRate(input.taxStatus);
  const taxBrl = totalCouponBrl * bondTaxRate;
  const taxKrw = roundDown(taxBrl * maturityFx, 2);
  const postTaxMaturityKrw = roundDown(preTaxMaturityKrw - taxKrw, 2);

  const investmentDays =
    getInvestmentDays(input.trustContractDate, input.maturityDate) ?? 0;
  const backFeeAmount = roundDown(
    (trustAmount * (backFeeRate / 100) / 365) * investmentDays,
    2
  );
  const postTaxYield =
    investmentDays > 0
      ? ((postTaxMaturityKrw - trustAmount) / trustAmount) * (365 / investmentDays)
      : 0;

  const parsedComp = Number(input.comprehensiveTaxRate);
  const comprehensiveTaxRate =
    input.comprehensiveTaxRate && !Number.isNaN(parsedComp)
      ? parsedComp / 100
      : 0.154;

  return {
    rows,
    initialUnits,
    initialPu: pricing.dirtyPrice,
    summary: {
      finalUnits: units,
      addedUnits: units - initialUnits,
      totalCouponBrl,
      preTaxMaturityKrw,
      postTaxMaturityKrw,
      postTaxYield,
      bankEquivalentYield: postTaxYield / (1 - comprehensiveTaxRate),
      backFee: {
        base: trustAmount,
        ratePct: backFeeRate,
        days: investmentDays,
        amount: backFeeAmount,
      },
    },
  };
}
