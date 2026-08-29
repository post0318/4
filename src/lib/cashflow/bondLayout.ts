export type CalcBasis =
  | "미국 30/360"
  | "ACT/ACT"
  | "ACT/360"
  | "ACT/365"
  | "유럽 30/360"
  | "Business/252";

export type InvestorType = "개인" | "일반법인" | "금융법인";

export type CouponFrequency = "3개월" | "6개월" | "12개월";

/** 이 상품은 브라질 국채(NTN-F) 전용이라 거래통화 BRL·수탁통화 KRW로 고정된다 */
export type Currency = "KRW" | "BRL";

export type TaxStatus = "일반과세" | "비과세";

/** 지급구분: 월은 준비 중(1단계는 반기만 지원). 재투자형은 후속 검토 대상이라 선택지에서 제외 */
export type DistributionType = "월" | "반기";

export interface BondLayoutInput {
  calcBasis: CalcBasis;
  investorType: InvestorType;
  distributionType: DistributionType;

  name: string;
  issueDate: string;
  maturityDate: string;
  couponRate: string;
  couponFrequency: CouponFrequency;
  recentCouponDate: string;
  taxStatus: TaxStatus;
  creditRating: string;
  tradeCurrency: Currency;
  custodyCurrency: Currency;
  purchaseFxRate: string;
  maturityFxRate: string;

  trustContractDate: string;
  purchaseYield: string;

  trustInvestmentAmount: string;
  frontFeeRate: string;
  backFeeRate: string;
  incomeTaxRate: string;
  /** 현금성이율(%): 보유현금(KRW)에 적용하는 단리 이율 (PRD 규칙5) */
  cashInterestRate: string;
  /**
   * 유보율(%): 월지급 전용. 가입 시 신탁투자금액에서 이 비율만큼 현금을 유보해
   * 첫 쿠폰 전 월지급 재원으로 쓴다. 유보금액은 매수가능금액에서 제외된다.
   * 반기지급에서는 사용하지 않는다(0).
   */
  reserveRate: string;
}
