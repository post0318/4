import snapshot from "@/lib/server/ntnf-snapshot.json";

/**
 * 브라질채권검색 데이터 소스.
 *
 * 브라질 재무부 공식 오픈데이터는 tesourotransparente.gov.br의 14MB대 CSV뿐인데
 * (옛 JSON API는 2025-08부터 410 Gone, B3 API는 Cloudflare 봇차단), 이걸 요청
 * 시점에 받으면 다운로드에만 40초가 걸려 Vercel 함수 실행제한을 넘긴다. 그래서
 * 파싱한 소형 스냅샷(src/lib/server/ntnf-snapshot.json, NTN-F 최신 기준일자
 * 시세 몇 줄)을 레포에 커밋해두고 그대로 번들한다.
 *
 * 갱신: GitHub Actions(.github/workflows/refresh-ntnf.yml)가 매주
 * scripts/fetch-ntnf-snapshot.mjs 를 실행해 스냅샷을 다시 커밋하고, 그 커밋이
 * Vercel 재배포를 트리거한다. 로컬 수동 갱신도 같은 스크립트로 한다.
 * NTN-F 종목 목록 자체는 1년에 한두 번만 바뀌고, 표면이율은 연 10% 고정,
 * 매수금리(YTM)는 사용자가 화면에서 직접 조정하므로 주간 갱신으로 충분하다.
 *
 * 중간값 ± 호가차(오너 지시, 2026-10-09): buyRate/sellRate 는 스냅샷 스크립트가
 * 종목마다 같은 기준일(quoteDate)의 중간값 ∓ 호가차/2 로 만든 값이다
 * (scripts/lib/ntnf-quote.mjs). 중간값은 금리 차트와 같은 우선순위(ANBIMA 기관 지표 >
 * 재무부 CSV 평균 > 실시간), 호가차는 같은 시점·같은 출처의 매도 − 매수. 원값은 inputs.
 * 옛 형식 스냅샷(midRate 없음)은 기준이 달라 수익률을 비운다 — 시세 갱신을 다시 돌리면 채워진다.
 */

export type QuoteMidSource = "anbima" | "csv" | "live" | "live-sell";
export type QuoteSpreadSource = "csv" | "live" | "live-other";

export interface BrazilBondItem {
  maturityDate: string; // ISO (YYYY-MM-DD)
  /** 매수수익률(%) = midRate − spread/2. 못 구하면 null(사유는 note) */
  buyRate: number | null;
  /** 매도수익률(%) = midRate + spread/2 */
  sellRate: number | null;
  /** 중간값(%) */
  midRate: number | null;
  /** 호가차(%p) = 같은 시점·같은 출처의 매도 − 매수 */
  spread: number | null;
  /** 중간값·호가차의 기준일 */
  quoteDate: string | null;
  midSource: QuoteMidSource | null;
  spreadSource: QuoteSpreadSource | null;
  /** spreadSource 가 live-other 일 때 호가차를 가져온 종목 만기 */
  spreadRef: string[] | null;
  /** true면 다른 종목 호가차 또는 실시간 매도만으로 만든 추정값 */
  estimated: boolean;
  /** 출처 조합 설명(화면 주석) 또는 비운 사유 */
  note: string;
}

export interface NtnFSnapshot {
  /** CSV 시세 기준일자(Data Base) */
  asOfDate: string;
  /** 스냅샷을 만든 시각(ISO) */
  generatedAt: string;
  /** 거래 플랫폼 실시간 기준일. 없으면 null */
  liveAsOfDate: string | null;
  /** ANBIMA 기관 지표 최신 기준일. 없으면 null */
  anbimaAsOfDate: string | null;
  /** 종목 시세 기준일 중 가장 이른 날 — 노후 판정·화면 기준일 */
  quoteAsOfDate: string | null;
  items: BrazilBondItem[];
}

const LEGACY_NOTE =
  "시세 파일이 옛 형식(중간값·호가차 없음)이라 수익률을 비웠습니다. 시세 갱신(Refresh NTN-F snapshot)을 다시 실행하세요.";

export function getLatestNtnF(): NtnFSnapshot {
  const raw = snapshot as unknown as {
    asOfDate: string;
    generatedAt: string;
    liveAsOfDate?: string | null;
    anbimaAsOfDate?: string | null;
    quoteAsOfDate?: string | null;
    bonds: Array<Partial<BrazilBondItem> & { maturityDate: string }>;
  };
  const items: BrazilBondItem[] = raw.bonds.map((b) => {
    if (!("midRate" in b)) {
      return {
        maturityDate: b.maturityDate,
        buyRate: null,
        sellRate: null,
        midRate: null,
        spread: null,
        quoteDate: null,
        midSource: null,
        spreadSource: null,
        spreadRef: null,
        estimated: false,
        note: LEGACY_NOTE,
      };
    }
    return {
      maturityDate: b.maturityDate,
      buyRate: b.buyRate ?? null,
      sellRate: b.sellRate ?? null,
      midRate: b.midRate ?? null,
      spread: b.spread ?? null,
      quoteDate: b.quoteDate ?? null,
      midSource: b.midSource ?? null,
      spreadSource: b.spreadSource ?? null,
      spreadRef: b.spreadRef ?? null,
      estimated: b.estimated === true,
      note: b.note ?? "",
    };
  });
  return {
    asOfDate: raw.asOfDate,
    generatedAt: raw.generatedAt,
    liveAsOfDate: raw.liveAsOfDate ?? null,
    anbimaAsOfDate: raw.anbimaAsOfDate ?? null,
    quoteAsOfDate: raw.quoteAsOfDate ?? null,
    items,
  };
}
