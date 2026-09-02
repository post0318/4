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

import { truncDecimals } from "@/lib/format";

export interface OrderInputs {
  /** 달러 환전액 (USD) — 자동 산출값 또는 사용자 수정값 */
  usdAmount: number;
  /** 원/달러 (1 USD = ? KRW) — 1좌당 원화가격 환산용 */
  usdKrw: number;
  /** 달러/헤알 (1 USD = ? BRL) */
  usdBrl: number;
  /** NTN-F 매수단가 (PU, per 1,000 face = per título, BRL) */
  pu: number;
  /**
   * 안전 버퍼(%). 주문시점(한국시간)과 체결시점(브라질현지시간) 사이 가격·환율
   * 변동으로 결제금액이 환전액을 초과하는 것을 막기 위해, 좌수 계산에서 PU와
   * 달러/헤알(USD/BRL)을 각각 버퍼%만큼 불리하게 잡는다 —
   * PU × (1+버퍼)(더 비싸게), USD/BRL × (1−버퍼)(같은 달러로 사는 헤알 감소).
   * 없으면 0. 예: 버퍼 10%, PU 1000·USD/BRL 5.40 → PU 1100·USD/BRL 4.86 로 계산.
   */
  bufferPct?: number;
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

/** 소수 2자리에서 절사 (부동소수 표현오차 보정) */
function trunc2(n: number): number {
  return truncDecimals(n, 2);
}

/**
 * 환전금액의 달러금액(totalUsd)을 각 종목의 원화투자금액 비중대로 나눈다.
 * 각 몫은 소수 2자리에서 절사하고, 절사로 생긴 잔동(= trunc2(totalUsd) − Σ몫)은
 * 원화투자금액이 가장 큰 종목에 가산해 Σ가 정확히 trunc2(totalUsd)가 되게 한다.
 * totalUsd나 원화 합계가 0 이하면 전부 0을 돌려준다.
 */
export function distributeUsdByKrwWeight(
  totalUsd: number,
  items: { key: string; krw: number }[]
): Record<string, number> {
  const out: Record<string, number> = {};
  const target = trunc2(totalUsd);
  const totalKrw = items.reduce((s, i) => s + (i.krw > 0 ? i.krw : 0), 0);
  if (!(target > 0) || !(totalKrw > 0)) {
    for (const i of items) out[i.key] = 0;
    return out;
  }
  let assigned = 0;
  let biggestKey = items[0]?.key ?? "";
  let biggestKrw = -1;
  for (const i of items) {
    const share = i.krw > 0 ? trunc2((target * i.krw) / totalKrw) : 0;
    out[i.key] = share;
    assigned += share;
    if (i.krw > biggestKrw) {
      biggestKrw = i.krw;
      biggestKey = i.key;
    }
  }
  if (biggestKey) {
    const remainder = Math.round((target - assigned) * 100) / 100;
    out[biggestKey] = Math.round((out[biggestKey] + remainder) * 100) / 100;
  }
  return out;
}

export function computeOrder(input: OrderInputs): OrderResult {
  const { usdAmount, usdKrw, usdBrl, pu, bufferPct } = input;

  const brlAmount = round(usdAmount * usdBrl, 2);

  // 안전 버퍼: 좌수 계산에만 적용. PU는 (1+버퍼)배 비싸게, USD/BRL은 (1−버퍼)배
  // (같은 달러로 사는 헤알 감소) → 결제금액이 환전액을 넘지 않도록 여유.
  const buf = Math.max(0, Math.min(100, bufferPct ?? 0)) / 100;
  const puEff = pu * (1 + buf);
  const brlForQty = round(usdAmount * usdBrl * (1 - buf), 2);
  const quantity = Math.floor(brlForQty / puEff);

  const krwPerUnit = Math.round((pu * usdKrw) / usdBrl);

  return { usdAmount, brlAmount, quantity, krwPerUnit };
}
