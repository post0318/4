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
  /** 매수수익률 (Taxa Compra = 투자자 매수 금리, 연 %) */
  buyYieldPct: number | null;
  /** 매도수익률 (Taxa Venda = 투자자 환매 금리, 연 %) — 참고용 */
  sellYieldPct: number | null;
}

export interface BondSearchResponse {
  asOfDate: string;
  /** 기준일 경과일수 (서버 계산) */
  ageDays?: number | null;
  /** 기준일이 10일 넘게 지남 — 주간 갱신 실패 가능성, 화면 경고 */
  stale?: boolean;
  bonds: BondItem[];
}

/** 시세 스냅샷 신선도 — 화면 경고용 */
export interface QuoteFreshness {
  asOfDate: string | null;
  ageDays: number | null;
  stale: boolean;
}
