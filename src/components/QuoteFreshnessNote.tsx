import type { QuoteFreshness } from "@/lib/types";

interface Props {
  quote: QuoteFreshness | null;
  /** 결제일을 함께 표시 (트레이딩) */
  settlementDate?: string;
  /** 작게(캡션) 표시 — 현금흐름 종목명 옆 */
  compact?: boolean;
}

/**
 * 시세 기준일 표시 + 노후 경고 (감사 ⑤ 중3). 기준일이 10일 넘게 지났으면
 * 노란 경고 띠로 바뀐다 — 주간 갱신(GitHub Actions)이 실패했을 가능성.
 */
export function QuoteFreshnessNote({ quote, settlementDate }: Props) {
  if (!quote?.asOfDate) return null;
  const tail = settlementDate ? ` · 결제일 ${settlementDate}` : "";
  // 거래 플랫폼 실시간 보정 — 매도가는 전종목, 매수가는 신규모집 종목만 반영된다
  // (오너 지시, 2026-09-24). 「보정」이지 전체 최신화가 아니므로 문구로 명시한다.
  const liveTail =
    quote.liveAsOfDate && quote.liveAsOfDate !== quote.asOfDate
      ? ` · 매도수익률 실시간(${quote.liveAsOfDate}, 재무부 오전 호가) · 실제 판매 중이 아닌 종목의 매수수익률은 추정`
      : "";
  if (quote.stale) {
    return (
      <p
        role="alert"
        className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs font-medium text-amber-800 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-300"
      >
        ⚠ 시세가 {quote.ageDays ?? "?"}일 전({quote.asOfDate}) 기준입니다. 일일 갱신이
        실패했을 수 있으니 확인 후 사용하세요.{liveTail}{tail}
      </p>
    );
  }
  return (
    <p
      className="text-xs text-zinc-600 dark:text-zinc-300"
    >
      시세 기준일 {quote.asOfDate}
      {quote.ageDays != null && quote.ageDays > 0 ? ` (${quote.ageDays}일 전)` : ""}
      {liveTail}
      {tail}
    </p>
  );
}
