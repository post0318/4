/**
 * NTN-F(Tesouro Prefixado com Juros Semestrais) 종목 메타데이터.
 *
 * 재무부 공개 CSV(ntnf-snapshot.json의 원본)에는 만기일·금리·PU만 있고 ISIN과
 * 종목명이 없다. ISIN은 발행 회차(reabertura)마다 여러 개가 존재하고 스트립
 * 채권(원금만/이표만)까지 있어, 여기서는 "COM CUPONS · NORMAL"(테조우로 다이렉트에서
 * 실제 거래되는 완본) 기준 ISIN을 만기연도로 매핑한다.
 *
 * 출처: maisretorno.com / investira.biz 티툴루스 퍼블리쿠스 DB. 2027~2035는
 * 복수 출처로 교차 확인됨(verified). 2037은 형제 종목 패턴 기반 추정이라
 * 화면에 "확인 필요" 뱃지를 띄운다. 공식 확인처는 브라질 재무부(STN) 등록부.
 */

export interface NtnfMeta {
  /** COM CUPONS · NORMAL 기준 ISIN */
  isin: string;
  /** ISIN 교차확인 여부 (false면 화면에 "확인 필요" 표시) */
  isinVerified: boolean;
  /** 한글 종목명 */
  nameKo: string;
  /** 포르투갈어 공식 상품명 */
  namePt: string;
}

/** 만기연도(YYYY) → 메타데이터 */
const NTNF_META: Record<string, NtnfMeta> = {
  "2027": {
    isin: "BRSTNCNTF1P8",
    isinVerified: true,
    nameKo: "브라질국채 NTN-F 2027",
    namePt: "Tesouro Prefixado com Juros Semestrais 2027",
  },
  "2029": {
    isin: "BRSTNCNTF1Y0",
    isinVerified: true,
    nameKo: "브라질국채 NTN-F 2029",
    namePt: "Tesouro Prefixado com Juros Semestrais 2029",
  },
  "2031": {
    isin: "BRSTNCNTF204",
    isinVerified: true,
    nameKo: "브라질국채 NTN-F 2031",
    namePt: "Tesouro Prefixado com Juros Semestrais 2031",
  },
  "2033": {
    isin: "BRSTNCNTF212",
    isinVerified: true,
    nameKo: "브라질국채 NTN-F 2033",
    namePt: "Tesouro Prefixado com Juros Semestrais 2033",
  },
  "2035": {
    isin: "BRSTNCNTF2J9",
    isinVerified: true,
    nameKo: "브라질국채 NTN-F 2035",
    namePt: "Tesouro Prefixado com Juros Semestrais 2035",
  },
  "2037": {
    isin: "BRSTNCNTF2K7",
    isinVerified: false,
    nameKo: "브라질국채 NTN-F 2037",
    namePt: "Tesouro Prefixado com Juros Semestrais 2037",
  },
};

export function getNtnfMeta(maturityDate: string): NtnfMeta | null {
  const year = maturityDate.slice(0, 4);
  return NTNF_META[year] ?? null;
}

export function ntnfDisplayName(maturityDate: string): string {
  const meta = getNtnfMeta(maturityDate);
  if (meta) return meta.nameKo;
  return `브라질국채 NTN-F ${maturityDate.slice(0, 4)}`;
}
