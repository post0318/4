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
  // 전부 걸러지면 last가 undefined → crossCheck가 NaN 비교로 "mismatch"가 되므로
  // 명시적으로 실패 처리한다 (감사 ⑤ 낮음).
  if (clean.values.length === 0) {
    return NextResponse.json(
      { error: "기준금리 추이 데이터가 비어 있습니다." },
      { status: 502 }
    );
  }

  // 교차검증: 마지막 값이 독립 조회한 최신값과 일치하는지.
  // SGS 432 는 Copom 이 의결한 "다음 적용분"을 미리 실어 보낸다(예: 오늘이
  // 9/17 인데 11/4 부터 13.75%). 아직 오지 않은 고시분과 비교하면 항상
  // mismatch 가 나므로, 오늘 이후 날짜면 검증 대상에서 뺀다.
  const latest = await fetchSelicLatest();
  const last = clean.values[clean.values.length - 1];
  const today = iso(new Date());
  const latestIsFuture = !!latest?.date && latest.date > today;
  const crossCheck =
    latest == null
      ? "unavailable"
      : latestIsFuture
        ? "skipped-future"
        : Math.abs(latest.value - last) < 0.01
          ? "ok"
          : "mismatch";

  return NextResponse.json({
    dates: clean.dates,
    values: clean.values,
    dropped: clean.dropped,
    /** 현재 적용 중인 기준금리 (시계열 마지막 값) */
    latest: last,
    /** 다음 적용 예정분 (Copom 의결 후 아직 시행 전이면 채워진다) */
    upcoming: latestIsFuture
      ? { value: latest.value, date: latest.date }
      : null,
    crossCheck,
    source: "Banco Central do Brasil · SGS 432 (Meta Selic)",
  });
}
