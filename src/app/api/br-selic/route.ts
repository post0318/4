import { NextResponse } from "next/server";
import { fetchSelicHistory, fetchSelicLatest } from "@/lib/server/bcbRate";
import { BOUNDS, sanitizeSeries } from "@/lib/server/sanity";

// 12시간마다 재검증 (Copom 회의 때만 바뀜)
export const revalidate = 43200;

/**
 * 브라질 기준금리(Selic meta) 7년치 추이. 브라질 중앙은행 SGS(무인증).
 * 값이 바뀐 시점만 담아 계단식으로 그린다.
 */
export async function GET() {
  const to = new Date();
  const from = new Date(to);
  from.setFullYear(from.getFullYear() - 7);
  const iso = (d: Date) => d.toISOString().slice(0, 10);

  const series = await fetchSelicHistory(iso(from), iso(to));
  if (!series) {
    return NextResponse.json(
      { error: "기준금리 추이를 불러오지 못했습니다." },
      { status: 502 }
    );
  }

  const clean = sanitizeSeries(series.dates, series.values, BOUNDS.ratePct);

  // 교차검증: 마지막 값이 독립 조회한 최신값과 일치하는지
  const latest = await fetchSelicLatest();
  const last = clean.values[clean.values.length - 1];
  const crossCheck =
    latest == null
      ? "unavailable"
      : Math.abs(latest - last) < 0.01
        ? "ok"
        : "mismatch";

  return NextResponse.json({
    dates: clean.dates,
    values: clean.values,
    dropped: clean.dropped,
    crossCheck,
    source: "Banco Central do Brasil · SGS 432 (Meta Selic)",
  });
}
