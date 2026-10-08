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
 * 주문용 매수·매도수익률(오너 결정, 2026-10-09): buyRate/sellRate 는 같은 기준 시각의 쌍이다
 * (scripts/lib/ntnf-quote.mjs) — 재무부 실시간 호가(같은 시각 같은 종목, 매수 호가가 없으면 같은
 * 시각 다른 종목 호가차로 추정) > 최신 재무부 CSV 같은 기준일 원값(실시간 없음 경고).
 * ANBIMA 는 쓰지 않는다(10년물 차트 전용). 옛 형식 스냅샷(quoteDate 없음)은 수익률을 비운다.
 */

/** live = 실시간 같은 종목 쌍, live-est = 실시간 매도 − 다른 종목 호가차(추정), csv = 실시간 없음 */
export type QuoteSource = "live" | "live-est" | "csv";

export interface BrazilBondItem {
  maturityDate: string; // ISO (YYYY-MM-DD)
  /** 매수수익률(%, Taxa Compra 쪽). 못 구하면 null(사유는 note) */
  buyRate: number | null;
  /** 매도수익률(%, Taxa Venda 쪽) */
  sellRate: number | null;
  /** 호가차(%p) = 매도 − 매수 */
  spread: number | null;
  /** 매수·매도 쌍의 기준일 */
  quoteDate: string | null;
  source: QuoteSource | null;
  /** source 가 live-est 일 때 호가차를 가져온 종목 만기 */
  spreadRef: string[] | null;
  /** true면 다른 종목 호가차로 만든 추정 매수수익률 */
  estimated: boolean;
  /** 출처 설명(화면 주석) 또는 비운 사유 */
  note: string;
}

export interface NtnFSnapshot {
  /** CSV 시세 기준일자(Data Base) */
  asOfDate: string;
  /** 스냅샷을 만든 시각(ISO) */
  generatedAt: string;
  /** 거래 플랫폼 실시간 기준일. 없으면 null */
  liveAsOfDate: string | null;
  /** 종목 시세 기준일 중 가장 이른 날 — 노후 판정·화면 기준일 */
  quoteAsOfDate: string | null;
  items: BrazilBondItem[];
}

const LEGACY_NOTE =
  "시세 파일이 옛 형식이라 수익률을 비웠습니다. 시세 갱신(Refresh NTN-F snapshot)을 다시 실행하세요.";

export function getLatestNtnF(): NtnFSnapshot {
  const raw = snapshot as unknown as {
    asOfDate: string;
    generatedAt: string;
    liveAsOfDate?: string | null;
    quoteAsOfDate?: string | null;
    bonds: Array<Partial<BrazilBondItem> & { maturityDate: string }>;
  };
  const items: BrazilBondItem[] = raw.bonds.map((b) => {
    if (!("quoteDate" in b) || !("source" in b)) {
      return {
        maturityDate: b.maturityDate,
        buyRate: null,
        sellRate: null,
        spread: null,
        quoteDate: null,
        source: null,
        spreadRef: null,
        estimated: false,
        note: LEGACY_NOTE,
      };
    }
    return {
      maturityDate: b.maturityDate,
      buyRate: b.buyRate ?? null,
      sellRate: b.sellRate ?? null,
      spread: b.spread ?? null,
      quoteDate: b.quoteDate ?? null,
      source: b.source ?? null,
      spreadRef: b.spreadRef ?? null,
      estimated: b.estimated === true,
      note: b.note ?? "",
    };
  });
  return {
    asOfDate: raw.asOfDate,
    generatedAt: raw.generatedAt,
    liveAsOfDate: raw.liveAsOfDate ?? null,
    quoteAsOfDate: raw.quoteAsOfDate ?? null,
    items,
  };
}
