import { CashFlowRow } from "@/lib/cashflow/cashFlowSchedule";
import { BondPricingResult, roundDown } from "@/lib/cashflow/bondPricing";
import {
  getInvestmentDays,
  getTrustMaturityLeadDays,
} from "@/lib/cashflow/couponSchedule";

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
  /**
   * 신탁만기일 수기 지정(YYYY-MM-DD). 비우면 자동(만기일 + 리드타임 11일).
   * 지정하면 (지정일 − 만기일) 이 리드타임이 되어 투자일수·만기청산 후취보수·
   * 만기 구간 현금성이자에 모두 반영된다.
   */
  trustMaturityDate?: string;
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
  /** 신탁 전 기간에 투자자가 실제 수령하는 세후 총액 (수익률 분자) */
  totalReceived: number;
  postTaxYield: number;
  /**
   * 세후 복리수익률(CAGR) = (총수령액/원금)^(365/투자일수) − 1.
   * 단리 연환산은 기간이 길수록 연 수익률을 부풀려 보이게 하므로 함께 낸다
   * (감사 ⑤ 중5). 쿠폰을 출금하는 방식(반기·월지급)에서는 "출금한 돈을 굴리지
   * 않는다"는 가정이 들어간다 — 출금 이후 운용은 상품 밖의 일이라 화면에 그
   * 가정을 함께 적는다.
   */
  postTaxCagr: number | null;
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
    input.maturityDate,
    input.trustMaturityDate
  );
  if (!investmentDays) return null;

  const principal = Number(input.trustInvestmentAmount);
  const backFeeRate = Number(input.backFeeRate);
  // 원금 0·음수, 후취보수 음수를 막는다(점검 L5 — 문자열 "0" 은 truthy).
  // 후취보수가 음수면 차감이 가산이 돼 수령액이 늘어난다.
  if (
    !input.trustInvestmentAmount ||
    !Number.isFinite(principal) ||
    principal <= 0 ||
    !input.backFeeRate ||
    !Number.isFinite(backFeeRate) ||
    backFeeRate < 0 ||
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

  // 첫 이자지급 회차에서 매수 시 선지급한 경과이자를 그대로 돌려받으므로,
  // 실제 투자에 묶인 원금은 이만큼 작다. 표의 "원금" 열에 괄호로 찍히는 값
  // (rows[0].principalReturn, 음수)을 그대로 써야 "경과이자차감 원금 + 경과이자
  // = 신탁원금" 검산이 정확히 맞는다. (쿠폰·과세분을 각각 절사해 역산하면
  // 이중 절사로 1원이 어긋난다.)
  const shownAccrued = rows[0].principalReturn ? -rows[0].principalReturn : 0;
  const investedPrincipal = roundDown(principal - shownAccrued, 2);

  // 만기청산(리드타임) 후취보수도 경과이자차감 원금 기준
  const lastBackFee = roundDown(
    ((investedPrincipal * (backFeeRate / 100)) / 365) *
      getTrustMaturityLeadDays(input.maturityDate, input.trustMaturityDate),
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
    totalReceived,
    postTaxYield,
    postTaxCagr:
      principal > 0 && investmentDays > 0 && totalReceived > 0
        ? Math.pow(totalReceived / principal, 365 / investmentDays) - 1
        : null,
    bankEquivalentYield,
  };
}
