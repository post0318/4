/**
 * 매수가능수량 산출 (핵심 요구사항 3).
 *
 * 원화투자금액 → 달러 환전액 → 헤알 환산액 → NTN-F 매수가능수량(정수, 1좌 = 액면
 * R$1,000). 환율은 모두 중간환율(스프레드 미반영)이며, 화면에 그 사실을 명시한다.
 * KRW→USD→BRL 경로만 쓰고 KRW/BRL은 usdBrl/usdKrw로 파생해 표시값과 계산을
 * 일치시킨다.
 *
 * computeOrder는 투자금액으로 살 수 있는 최대 수량(매수가능수량)을 낸다.
 * 실제 주문수량은 사용자가 그보다 줄여 넣을 수 있고, 그 수량 기준 실매수금액은
 * settleOrder로 따로 산출한다.
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
  /** 매수가능수량 (정수, 좌) */
  quantity: number;
}

export interface OrderCost {
  /** 실제 주문수량 (정수, 좌) */
  quantity: number;
  /** 실매수금액 (BRL) = quantity * pu */
  brlCost: number;
  /** 실매수금액 (USD 환산) */
  usdCost: number;
  /** 실매수금액 (KRW 환산) */
  krwCost: number;
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

  return { usdAmount, brlAmount, quantity };
}

/** 주어진 주문수량(정수 좌) 기준 실매수금액을 BRL·USD·KRW로 산출한다. */
export function settleOrder(input: OrderInputs, quantity: number): OrderCost {
  const q = Math.max(0, Math.trunc(quantity));
  const brlCost = round(q * input.pu, 2);
  const usdCost = round(brlCost / input.usdBrl, 2);
  const krwCost = Math.round(usdCost * input.usdKrw);
  return { quantity: q, brlCost, usdCost, krwCost };
}
