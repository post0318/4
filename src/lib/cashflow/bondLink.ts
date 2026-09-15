import {
  BondLayoutInput,
  CalcBasis,
  CouponFrequency,
  Currency,
  DistributionType,
  InvestorType,
  TaxStatus,
} from "@/lib/cashflow/bondLayout";

const COUPON_FREQUENCY_BY_CODE: Record<number, CouponFrequency> = {
  1: "3개월",
  2: "6개월",
  3: "12개월",
};

// 코드 2는 옛 "비과세(농특세)". 농특세 삭제로 이제 "비과세"와 동일하게 취급한다.
const TAX_STATUS_BY_CODE: Record<number, TaxStatus> = {
  1: "일반과세",
  2: "비과세",
  3: "비과세",
};

const DISTRIBUTION_BY_CODE: Record<number, DistributionType> = {
  1: "반기",
  2: "월",
  3: "재투자",
};

const CALC_BASIS_BY_CODE: Record<number, CalcBasis> = {
  1: "미국 30/360",
  2: "ACT/ACT",
  3: "ACT/360",
  4: "ACT/365",
  5: "유럽 30/360",
  6: "Business/252",
};

const CURRENCY_BY_CODE: Record<number, Currency> = {
  0: "KRW",
  5: "BRL",
};

const INVESTOR_TYPE_BY_CODE: Record<number, InvestorType> = {
  1: "개인",
  2: "일반법인",
  3: "금융법인",
};

// unpack이 받아들이는 최소 필드 수. 뒤에 붙는 필드(cashInterestRate 등)는
// 옛 링크엔 없을 수 있어 optional로 읽으므로 이 값은 올리지 않는다.
const FIELD_COUNT = 20;

const MS_PER_DAY = 86400000;

/**
 * 36진수 경과일수 -> "1996-04-01". 예전에 생성된 링크(8자리 숫자 압축)도
 * 계속 열 수 있도록 "YYYYMMDD" 형태는 그대로 이전 방식으로 복원한다.
 */
function restoreDateDashes(compact: string): string {
  if (/^\d{8}$/.test(compact)) {
    return `${compact.slice(0, 4)}-${compact.slice(4, 6)}-${compact.slice(6, 8)}`;
  }
  if (/^-?[0-9a-z]+$/.test(compact)) {
    const days = parseInt(compact, 36);
    if (!Number.isNaN(days)) {
      const dt = new Date(days * MS_PER_DAY);
      const y = dt.getUTCFullYear();
      const m = String(dt.getUTCMonth() + 1).padStart(2, "0");
      const d = String(dt.getUTCDate()).padStart(2, "0");
      return `${y}-${m}-${d}`;
    }
  }
  return compact;
}

/**
 * 옛 공유 링크(`?bond=` lz-string) 호환용 — "|" 구분 문자열을 입력값으로 되돌린다.
 * 새 링크는 `src/lib/cashflow/shareCodec.ts`(바이너리) + 서버 서명/토큰을 쓴다.
 * 링크 생성·해석은 모두 서버(`src/lib/server/shareLink.ts`)에서 한다.
 */
export function unpackLegacyBondText(text: string): Partial<BondLayoutInput> | null {
  const parts = text.split("|");
  if (parts.length < FIELD_COUNT) return null;

  const [
    name,
    issueDate,
    maturityDate,
    couponRate,
    couponFrequencyCode,
    recentCouponDate,
    taxStatusCode,
    calcBasisCode,
    creditRating,
    tradeCurrencyCode,
    custodyCurrencyCode,
    investorTypeCode,
    purchaseFxRate,
    maturityFxRate,
    trustContractDate,
    purchaseYield,
    trustInvestmentAmount,
    frontFeeRate,
    backFeeRate,
    incomeTaxRate,
    cashInterestRate,
    distributionCode,
    reserveRate,
  ] = parts;

  const result: Partial<BondLayoutInput> = {};
  if (name) result.name = name;
  if (issueDate) result.issueDate = restoreDateDashes(issueDate);
  if (maturityDate) result.maturityDate = restoreDateDashes(maturityDate);
  if (couponRate) result.couponRate = couponRate;
  if (recentCouponDate) result.recentCouponDate = restoreDateDashes(recentCouponDate);
  if (creditRating) result.creditRating = creditRating;
  if (purchaseFxRate) result.purchaseFxRate = purchaseFxRate;
  if (maturityFxRate) result.maturityFxRate = maturityFxRate;
  if (trustContractDate) result.trustContractDate = restoreDateDashes(trustContractDate);
  if (purchaseYield) result.purchaseYield = purchaseYield;
  if (trustInvestmentAmount) result.trustInvestmentAmount = trustInvestmentAmount;
  if (frontFeeRate) result.frontFeeRate = frontFeeRate;
  if (backFeeRate) result.backFeeRate = backFeeRate;
  if (incomeTaxRate) result.incomeTaxRate = incomeTaxRate;
  if (cashInterestRate) result.cashInterestRate = cashInterestRate;
  if (reserveRate) result.reserveRate = reserveRate;

  if (distributionCode) {
    const distributionType = DISTRIBUTION_BY_CODE[Number(distributionCode)];
    if (distributionType) result.distributionType = distributionType;
  }

  if (couponFrequencyCode !== "") {
    const couponFrequency = COUPON_FREQUENCY_BY_CODE[Number(couponFrequencyCode)];
    if (couponFrequency) result.couponFrequency = couponFrequency;
  }
  if (taxStatusCode !== "") {
    const taxStatus = TAX_STATUS_BY_CODE[Number(taxStatusCode)];
    if (taxStatus) result.taxStatus = taxStatus;
  }
  if (calcBasisCode !== "") {
    const calcBasis = CALC_BASIS_BY_CODE[Number(calcBasisCode)];
    if (calcBasis) result.calcBasis = calcBasis;
  }
  if (tradeCurrencyCode !== "") {
    const tradeCurrency = CURRENCY_BY_CODE[Number(tradeCurrencyCode)];
    if (tradeCurrency) result.tradeCurrency = tradeCurrency;
  }
  if (custodyCurrencyCode !== "") {
    const custodyCurrency = CURRENCY_BY_CODE[Number(custodyCurrencyCode)];
    if (custodyCurrency) result.custodyCurrency = custodyCurrency;
  }
  if (investorTypeCode !== "") {
    const investorType = INVESTOR_TYPE_BY_CODE[Number(investorTypeCode)];
    if (investorType) result.investorType = investorType;
  }

  return result;
}

