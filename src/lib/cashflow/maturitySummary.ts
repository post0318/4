import { CashFlowRow } from "@/lib/cashflow/cashFlowSchedule";
import { BondPricingResult, roundDown } from "@/lib/cashflow/bondPricing";
import { getInvestmentDays } from "@/lib/cashflow/couponSchedule";

const TRUST_MATURITY_LEAD_DAYS = 11;
const DEFAULT_COMPREHENSIVE_TAX_RATE = 0.154;

export interface MaturitySummaryInputs {
  trustContractDate: string;
  maturityDate: string;
  trustInvestmentAmount: string;
  backFeeRate: string;
  tradeCurrency: string;
  custodyCurrency: string;
  maturityFxRate: string;
  comprehensiveTaxRate: string;
}

export interface MaturitySummary {
  lastBackFee: number;
  /**
   * 신탁투자금액에서 첫 이자지급 시 돌려받는 경과이자(매수 시 선지급분)를 뺀 값.
   * 참고 표시용이며 수익률 분모가 아니다 — 수익률은 실제 유출액인 신탁투자금액
   * 전액(principal)을 기준으로 한다. 경과이자는 매수 비용(결제금액)과 첫 쿠폰
   * 양쪽에 이미 반영돼 상쇄되므로 수익률 계산에서 따로 빼지 않는다.
   */
  investedPrincipal: number;
  totalInterest: number;
  postTaxMaturityAmount: number;
  postTaxYield: number;
  bankEquivalentYield: number;
}

/** 경과이자차감 원금, 지급이자 총액, 만기시 세후금액, 세후수익률, 은행환산수익률 (fix.xlsx G10~G15) */
export function computeMaturitySummary(
  pricing: BondPricingResult,
  rows: CashFlowRow[],
  input: MaturitySummaryInputs
): MaturitySummary | null {
  const investmentDays = getInvestmentDays(
    input.trustContractDate,
    input.maturityDate
  );
  if (!investmentDays) return null;

  const principal = Number(input.trustInvestmentAmount);
  const backFeeRate = Number(input.backFeeRate);
  if (
    !input.trustInvestmentAmount ||
    Number.isNaN(principal) ||
    !input.backFeeRate ||
    Number.isNaN(backFeeRate) ||
    rows.length === 0
  ) {
    return null;
  }

  const needsFx = input.tradeCurrency !== input.custodyCurrency;
  const fx = needsFx ? Number(input.maturityFxRate) : 1;
  if (needsFx && (!fx || Number.isNaN(fx) || fx <= 0)) return null;

  const totalInterest = rows.reduce((sum, row) => sum + row.interest, 0);
  const totalPrincipal = rows.reduce((sum, row) => sum + row.principal, 0);
  const totalNetAmount = rows.reduce((sum, row) => sum + row.netAmount, 0);

  // 첫 이자지급 회차에서 (채권쿠폰 - 채권쿠폰 과세분)은 매수 시 선지급한
  // 경과이자로, 첫 이자지급 때 그대로 돌려받는다. 실제 투자에 묶인 원금은
  // 이만큼 작다. taxableIncome에는 보유현금 이자도 섞여 있으므로 빼고 본다.
  const bondTaxableRow0 = rows[0].taxableIncome - rows[0].cashInterest;
  const preOwnedInterest = rows[0].interest - bondTaxableRow0;
  const investedPrincipal = roundDown(principal - preOwnedInterest, 2);

  const lastBackFee = roundDown(
    ((principal * (backFeeRate / 100)) / 365) * TRUST_MATURITY_LEAD_DAYS,
    2
  );

  // 투자자가 신탁 전 기간에 실제 수령하는 세후 총액 (수익률 분자)
  const totalReceived = roundDown(
    totalNetAmount + totalPrincipal + pricing.cashBalance - lastBackFee,
    2
  );

  // "만기시 세후금액" = 만기 당일에 받는 금액(원금상환 + 마지막 쿠폰 세후 +
  // 반환 보유현금 − 만기청산 후취보수). 월지급표의 만기상환 행과 동일한 취급.
  const maturityRow = rows[rows.length - 1];
  const postTaxMaturityAmount =
    maturityRow?.maturityPayout ?? maturityRow?.netAmount ?? totalReceived;

  const postTaxYield =
    ((totalReceived - principal) / principal) * (365 / investmentDays);
  const parsedComprehensiveTaxRate = Number(input.comprehensiveTaxRate);
  const comprehensiveTaxRate =
    input.comprehensiveTaxRate && !Number.isNaN(parsedComprehensiveTaxRate)
      ? parsedComprehensiveTaxRate / 100
      : DEFAULT_COMPREHENSIVE_TAX_RATE;
  const bankEquivalentYield = postTaxYield / (1 - comprehensiveTaxRate);

  return {
    lastBackFee,
    investedPrincipal,
    totalInterest,
    postTaxMaturityAmount,
    postTaxYield,
    bankEquivalentYield,
  };
}
