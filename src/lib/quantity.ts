/**
 * 매수가능수량 산출 (핵심 요구사항 3).
 *
 * 달러 환전액 → 헤알 환산액 → NTN-F 매수가능수량(정수, 1좌 = 액면 R$1,000).
 * 달러 환전액은 기본적으로 원화투자금액 ÷ (원/달러)로 자동 산출하지만 화면에서
 * 직접 수정할 수 있고, 그 값을 그대로 쓴다. 환율은 모두 중간환율(스프레드 미반영).
 *
 * computeOrder는 그 달러 환전액으로 살 수 있는 최대 수량(매수가능수량)과
 * 1좌당 매수가격(원 환산)을 낸다. 실제 주문수량은 사용자가 그 이하로 지정한다.
 */

export interface OrderInputs {
  /** 달러 환전액 (USD) — 자동 산출값 또는 사용자 수정값 */
  usdAmount: number;
  /** 원/달러 (1 USD = ? KRW) — 1좌당 원화가격 환산용 */
  usdKrw: number;
  /** 달러/헤알 (1 USD = ? BRL) */
  usdBrl: number;
  /** NTN-F 매수단가 (PU, per 1,000 face = per título, BRL) */
  pu: number;
}

export interface OrderResult {
  /** 달러 환전액 (USD) */
  usdAmount: number;
  /** 헤알 환산액 (BRL) */
  brlAmount: number;
  /** 매수가능수량 (정수, 좌) */
  quantity: number;
  /** 1좌당 매수가격 (KRW 환산) = PU × 원/헤알 */
  krwPerUnit: number;
}

function round(value: number, digits: number): number {
  const factor = Math.pow(10, digits);
  return Math.round(value * factor) / factor;
}

export function isValidOrderInputs(input: Partial<OrderInputs>): input is OrderInputs {
  return (
    typeof input.usdAmount === "number" &&
    input.usdAmount > 0 &&
    Number.isFinite(input.usdAmount) &&
    typeof input.usdKrw === "number" &&
    input.usdKrw > 0 &&
    typeof input.usdBrl === "number" &&
    input.usdBrl > 0 &&
    typeof input.pu === "number" &&
    input.pu > 0
  );
}

export function computeOrder(input: OrderInputs): OrderResult {
  const { usdAmount, usdKrw, usdBrl, pu } = input;

  const brlAmount = round(usdAmount * usdBrl, 2);
  const quantity = Math.floor(brlAmount / pu);
  const krwPerUnit = Math.round((pu * usdKrw) / usdBrl);

  return { usdAmount, brlAmount, quantity, krwPerUnit };
}
