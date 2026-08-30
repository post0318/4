/**
 * NTN-F 금리 민감도 — 수정듀레이션·컨벡시티를 매수단가(PU) 공식에서 수치미분으로
 * 구한다. computeNtnfPu가 Business/252 지수할인이라 해석적 공식 대신 중앙차분을 쓴다.
 *
 * 수정듀레이션 D* (년): 수익률이 100bp(=1.00%p) 움직일 때 가격이 약 D*% 변한다.
 *   ΔP/P ≈ -D*·Δy(%p)/100 + ½·C·(Δy/100)²
 */

import { computeNtnfPu, getOrderSettlementDate, today } from "@/lib/ntnfPricing";

export interface BondRisk {
  pu: number;
  /** 수정듀레이션 (년, = 100bp 당 %가격변화) */
  modDuration: number;
  /** 컨벡시티 */
  convexity: number;
  /** 수익률 0.01%p(1bp) 변화 시 PU(액면 R$1,000) 변화액 (구 DV01) */
  dv01: number;
}

export function bondRisk(maturity: string, yieldPct: number): BondRisk | null {
  const settle = getOrderSettlementDate(today());
  const h = 0.05; // ±0.05 %p 중앙차분
  const p0 = computeNtnfPu(maturity, yieldPct, settle);
  const pUp = computeNtnfPu(maturity, yieldPct + h, settle);
  const pDn = computeNtnfPu(maturity, yieldPct - h, settle);
  if (p0 == null || pUp == null || pDn == null || p0 <= 0) return null;

  const d1 = (pUp - pDn) / (2 * h); // dP/dy   (per %p, 음수)
  const d2 = (pUp - 2 * p0 + pDn) / (h * h); // d²P/dy² (per %p²)
  const modDuration = (-d1 / p0) * 100; // 년
  const convexity = (d2 / p0) * 10000; // decimal 기준
  return { pu: p0, modDuration, convexity, dv01: (-d1 / p0) * p0 * 0.01 };
}

/**
 * 금리 Δy(%p)·환율 ΔfxPct(%) 동시 변동 시 결과.
 * 가격변화는 듀레이션+컨벡시티 2차 근사, 환율은 곱셈결합.
 */
export function shockReturn(
  risk: BondRisk,
  dyPct: number,
  dFxPct: number
): { pricePct: number; fxPct: number; krwPct: number } {
  const dyDec = dyPct / 100;
  const priceR =
    -risk.modDuration * dyDec + 0.5 * risk.convexity * dyDec * dyDec;
  const fxR = dFxPct / 100;
  return {
    pricePct: priceR * 100,
    fxPct: dFxPct,
    krwPct: ((1 + priceR) * (1 + fxR) - 1) * 100,
  };
}
