/**
 * 매수수량 산출 (핵심 요구사항 3).
 *
 * 원화투자금액 → 달러 환전액 → 헤알 환산액 → NTN-F 매수수량(정수, 1좌 = 액면
 * R$1,000). 환율은 모두 중간환율(스프레드 미반영)이며, 화면에 그 사실을 명시한다.
 * KRW→USD→BRL 경로만 쓰고 KRW/BRL은 usdBrl/usdKrw로 파생해 표시값과 계산을
 * 일치시킨다.
 */

export interface OrderInputs {
  /** 원화투자금액 (KRW) */
  krwAmount: number;
  /** 원/달러 (1 USD = ? KRW) */
  usdKrw: number;
  /** 달러/헤알 (1 USD = ? BRL) */
  usdBrl: number;
  /** NTN-F 매수단가 (PU, per 1,000 face = per título, BRL) */
  pu: number;
}

export interface OrderResult {
  /** 환전된 달러금액 (USD) */
  usdAmount: number;
  /** 헤알 환산액 (BRL) */
  brlAmount: number;
  /** 매수수량 (정수, 좌) */
  quantity: number;
  /** 실매수금액 (BRL) = quantity * pu */
  brlCost: number;
  /** 실매수금액 (KRW 환산) */
  krwCost: number;
  /** 잔여현금 (KRW 환산) */
  krwLeftover: number;
}

function round(value: number, digits: number): number {
  const factor = Math.pow(10, digits);
  return Math.round(value * factor) / factor;
}

export function isValidOrderInputs(input: Partial<OrderInputs>): input is OrderInputs {
  return (
    typeof input.krwAmount === "number" &&
    input.krwAmount > 0 &&
    Number.isFinite(input.krwAmount) &&
    typeof input.usdKrw === "number" &&
    input.usdKrw > 0 &&
    typeof input.usdBrl === "number" &&
    input.usdBrl > 0 &&
    typeof input.pu === "number" &&
    input.pu > 0
  );
}

export function computeOrder(input: OrderInputs): OrderResult {
  const { krwAmount, usdKrw, usdBrl, pu } = input;

  const usdAmount = round(krwAmount / usdKrw, 2);
  const brlAmount = round(usdAmount * usdBrl, 2);

  const quantity = Math.floor(brlAmount / pu);

  const brlCost = round(quantity * pu, 2);
  const usdCost = round(brlCost / usdBrl, 2);
  const krwCost = Math.round(usdCost * usdKrw);
  const krwLeftover = Math.round(krwAmount - krwCost);

  return { usdAmount, brlAmount, quantity, brlCost, krwCost, krwLeftover };
}
