import { TaxStatus } from "@/lib/cashflow/bondLayout";

// 이자소득세 = 소득세 14% + 지방소득세 1.4% = 15.4%. 채권이자·현금이자 모두
// 과세되는 경우 동일 세율을 적용한다.
const GENERAL_TAX_RATE = 0.154;

/**
 * 브라질 국채 조세조약상 비과세는 "채권이자"에만 적용된다. 신탁 내 원화
 * 보유현금에서 나오는 현금성이자는 국내 이자소득이라 과세여부와 무관하게
 * 소득세 15.4%(소득세 14% + 지방소득세 1.4%)를 낸다.
 */
export const CASH_INTEREST_TAX_RATE = 0.154;

/** 채권이자 소득세율. 일반과세면 15.4%(소득세 14% + 지방소득세 1.4%), 비과세면 0%. */
export function getEffectiveIncomeTaxRate(taxStatus: TaxStatus): number {
  return taxStatus === "일반과세" ? GENERAL_TAX_RATE : 0;
}
