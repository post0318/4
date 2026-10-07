import { NextResponse } from "next/server";
import yieldHistory from "@/lib/server/ntnf-yield-history.json";
import { BOUNDS, sanitizeSeries } from "@/lib/server/sanity";

/**
 * 브라질 장기국채금리(NTN-F ~10년) 7년 추이. 레포에 커밋된 파일을 그대로 반환한다.
 * 원본은 재무부 CSV(14MB)라 요청 시점에 못 받고, 매일 GitHub Actions가 갱신 커밋한다. CSV가 늦은 최근 날짜는 실시간 매도수익률 임시 점(live)으로 채운다.
 */
export async function GET() {
  const clean = sanitizeSeries(
    yieldHistory.points.map((p) => p.date),
    yieldHistory.points.map((p) => p.ytm),
    BOUNDS.ratePct
  );
  const live = (yieldHistory.points as { date: string; live?: boolean }[]).filter((p) => p.live).map((p) => p.date);
  // 마지막 두 점의 하루 변동(%p) — 큰 급변은 화면에 알린다(실제 시장 움직임일 수도 있다)
  const n = clean.values.length;
  const lastMove = n >= 2 ? Math.round((clean.values[n - 1] - clean.values[n - 2]) * 100) / 100 : null;
  return NextResponse.json({
    label: yieldHistory.label,
    asOfDate: yieldHistory.asOfDate,
    csvAsOfDate: (yieldHistory as { csvAsOfDate?: string }).csvAsOfDate ?? yieldHistory.asOfDate,
    liveDates: live,
    anbimaDates: (yieldHistory as { anbimaDates?: string[] }).anbimaDates ?? [],
    lastMove,
    dates: clean.dates,
    values: clean.values,
    dropped: clean.dropped,
    source: "기관 지표 ANBIMA(최근) · Tesouro Transparente 매수·매도 중간값(과거) · 재무부 실시간(임시) · 일일 갱신",
  });
}
