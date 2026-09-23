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
 * 실시간 보정(오너 지시, 2026-09-24): CSV가 며칠씩 멈추는 사고를 겪어,
 * scripts/fetch-ntnf-snapshot.mjs 가 거래 플랫폼(tesourodireto.com.br) 실시간
 * API로 값을 덮어쓴다 — 매도가(sellRate/sellPrice)는 6종목 다, 매수가
 * (buyRate/buyPrice)는 재무부가 신규모집 중인 종목만(보통 1개). `sellLive`/
 * `buyLive` 가 true인 필드만 asOfDate가 아니라 liveAsOfDate 기준이다.
 */

export interface BrazilBondItem {
  maturityDate: string; // ISO (YYYY-MM-DD)
  buyRate: number | null; // Taxa Compra Manha (%) — sellLive 없으면 asOfDate 기준, 있으면 liveAsOfDate 기준
  sellRate: number | null; // Taxa Venda Manha (%)
  buyPrice: number | null; // PU Compra Manha
  sellPrice: number | null; // PU Venda Manha
  /** true면 buyRate/buyPrice가 거래 플랫폼 실시간 값(liveAsOfDate 기준) */
  buyLive?: boolean;
  /** true면 sellRate/sellPrice가 거래 플랫폼 실시간 값(liveAsOfDate 기준) */
  sellLive?: boolean;
}

export interface NtnFSnapshot {
  /** CSV 시세 기준일자(Data Base) */
  asOfDate: string;
  /** 스냅샷을 만든 시각(ISO) */
  generatedAt: string;
  /** 거래 플랫폼 실시간 보정이 반영된 기준일. 보정 실패/없음이면 null */
  liveAsOfDate: string | null;
  items: BrazilBondItem[];
}

export function getLatestNtnF(): NtnFSnapshot {
  return {
    asOfDate: snapshot.asOfDate,
    generatedAt: snapshot.generatedAt,
    liveAsOfDate: snapshot.liveAsOfDate ?? null,
    items: snapshot.bonds as BrazilBondItem[],
  };
}
