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
  bonds: BondItem[];
}
