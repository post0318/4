import { NextResponse } from "next/server";
import yieldHistory from "@/lib/server/ntnf-yield-history.json";
import { BOUNDS, sanitizeSeries } from "@/lib/server/sanity";

/**
 * 브라질 장기국채금리(NTN-F ~10년) 7년 추이. 레포에 커밋된 파일을 그대로 반환한다.
 * 원본은 재무부 CSV(14MB)라 요청 시점에 못 받고, 주간 GitHub Actions가 갱신 커밋한다.
 */
export async function GET() {
  const clean = sanitizeSeries(
    yieldHistory.points.map((p) => p.date),
    yieldHistory.points.map((p) => p.ytm),
    BOUNDS.ratePct
  );
  return NextResponse.json({
    label: yieldHistory.label,
    asOfDate: yieldHistory.asOfDate,
    dates: clean.dates,
    values: clean.values,
    dropped: clean.dropped,
    source: "Tesouro Nacional (Tesouro Transparente) · 주간 갱신",
  });
}
