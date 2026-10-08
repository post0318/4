export interface FxRates {
  usdKrw: number;
  usdBrl: number;
  krwBrl: number;
  /** 조회 시각 (ISO) */
  asOf: string | null;
  /** ECB 고시일 "YYYY-MM-DD" (주말·휴일엔 조회일보다 이전) */
  rateDate?: string | null;
}

export interface BondItem {
  maturityDate: string;
  nameKo: string;
  namePt: string;
  isin: string | null;
  isinVerified: boolean;
  /** 매수수익률(연 %) = 중간값 − 호가차/2 (투자자 매수 금리, Taxa Compra 쪽). 못 구하면 null */
  buyYieldPct: number | null;
  /** 매도수익률(연 %) = 중간값 + 호가차/2 (투자자 환매 금리, Taxa Venda 쪽) — 참고용 */
  sellYieldPct: number | null;
  /** 중간값(연 %) — ANBIMA 기관 지표 > 재무부 CSV 평균 > 실시간 */
  midYieldPct?: number | null;
  /** 호가차(%p) — 같은 시점·같은 출처의 매도 − 매수 */
  spreadPct?: number | null;
  /** 중간값·호가차 기준일 */
  quoteDate?: string | null;
  /** 출처 조합 설명(또는 수익률을 비운 사유) */
  quoteNote?: string;
  /** true면 다른 종목 호가차 또는 실시간 매도만으로 만든 추정값 */
  buyYieldEstimated?: boolean;
}

export interface BondSearchResponse {
  /** 종목 시세 기준일(가장 이른 종목) */
  asOfDate: string;
  /** 재무부 CSV 기준일 */
  csvAsOfDate?: string;
  /** 기준일 경과일수 (서버 계산) */
  ageDays?: number | null;
  /** 거래 플랫폼 실시간 보정이 반영된 기준일. 없으면 null */
  liveAsOfDate?: string | null;
  /** 기준일이 10일 넘게 지남 — 주간 갱신 실패 가능성, 화면 경고 */
  stale?: boolean;
  bonds: BondItem[];
}

/** 시세 스냅샷 신선도 — 화면 경고용 */
export interface QuoteFreshness {
  asOfDate: string | null;
  ageDays: number | null;
  stale: boolean;
  /** 거래 플랫폼 실시간 보정이 반영된 기준일(매도가 6종목·매수가 일부). 없으면 null */
  liveAsOfDate?: string | null;
}
