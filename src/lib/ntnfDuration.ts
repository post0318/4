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
  // 중앙차분 스텝. computeNtnfPu가 PU를 소수 6자리 절사(truncPu)하므로 h를
  // 0.01 미만으로 낮추면 2차차분(컨벡시티)의 분자가 절사 격자에 삼켜져 붕괴한다
  // (h=0.005면 단기물 컨벡시티가 0으로). h=0.05는 양자화 노이즈와 절단오차
  // 사이의 최적 구간 — 함부로 줄이지 말 것.
  const h = 0.05;
  const p0 = computeNtnfPu(maturity, yieldPct, settle);
  const pUp = computeNtnfPu(maturity, yieldPct + h, settle);
  const pDn = computeNtnfPu(maturity, yieldPct - h, settle);
  if (
    p0 == null ||
    pUp == null ||
    pDn == null ||
    !Number.isFinite(p0) ||
    !Number.isFinite(pUp) ||
    !Number.isFinite(pDn) ||
    p0 <= 0
  ) {
    return null;
  }

  const d1 = (pUp - pDn) / (2 * h); // dP/dy   (per %p, 음수)
  const d2 = (pUp - 2 * p0 + pDn) / (h * h); // d²P/dy² (per %p²)
  return {
    pu: p0,
    modDuration: (-d1 / p0) * 100, // 년
    convexity: (d2 / p0) * 10000, // decimal 기준
    dv01: -d1 * 0.01, // 1bp(0.01%p)당 PU(액면 R$1,000) 변화액
  };
}

/**
 * 금리 Δy(%p)·환율 ΔfxPct(%) 동시 변동 시 결과.
 * 가격변화는 충격 수익률로 PU를 **직접 재평가**해 정확히 구하고(듀레이션+컨벡시티
 * 2차 근사는 재평가 실패 시 폴백), 환율은 곱셈결합한다.
 */
export function shockReturn(
  risk: BondRisk,
  maturity: string,
  yieldPct: number,
  dyPct: number,
  dFxPct: number
): { pricePct: number; fxPct: number; krwPct: number } {
  const fxR = dFxPct / 100;
  if (dyPct === 0) {
    return { pricePct: 0, fxPct: dFxPct, krwPct: fxR * 100 };
  }
  const pShock = computeNtnfPu(
    maturity,
    yieldPct + dyPct,
    getOrderSettlementDate(today())
  );
  const dyDec = dyPct / 100;
  const priceR =
    pShock != null && Number.isFinite(pShock) && risk.pu > 0
      ? pShock / risk.pu - 1 // 정확한 재평가
      : -risk.modDuration * dyDec + 0.5 * risk.convexity * dyDec * dyDec; // 폴백
  return {
    pricePct: priceR * 100,
    fxPct: dFxPct,
    krwPct: ((1 + priceR) * (1 + fxR) - 1) * 100,
  };
}
