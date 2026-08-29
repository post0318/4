export interface FxRates {
  usdKrw: number;
  usdBrl: number;
  krwBrl: number;
  asOf: string | null;
}

export interface BondItem {
  maturityDate: string;
  nameKo: string;
  namePt: string;
  isin: string | null;
  isinVerified: boolean;
  /** 매수수익률 (Taxa Venda, 연 %) */
  buyYieldPct: number | null;
  /** 매도수익률 (Taxa Compra, 연 %) — 참고용 */
  sellYieldPct: number | null;
}

export interface BondSearchResponse {
  asOfDate: string;
  bonds: BondItem[];
}
