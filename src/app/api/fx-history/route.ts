import { NextResponse } from "next/server";
import { fetchFxSeries } from "@/lib/server/fxRate";
import { BOUNDS, sanitizeSeries } from "@/lib/server/sanity";

// 12시간마다 재검증 (ECB는 하루 1회 갱신)
export const revalidate = 43200;

/**
 * 환율 7년치 일간 추이 (원/달러·달러/헤알·원/헤알).
 * Frankfurter 시계열(ECB 기준, 무인증). 원/헤알은 usdKrw/usdBrl 파생값이다.
 */
export async function GET() {
  const to = new Date();
  const from = new Date(to);
  from.setFullYear(from.getFullYear() - 7);
  const iso = (d: Date) => d.toISOString().slice(0, 10);

  const series = await fetchFxSeries(iso(from), iso(to));
  if (!series || series.dates.length === 0) {
    return NextResponse.json(
      { error: "환율 추이를 불러오지 못했습니다." },
      { status: 502 }
    );
  }

  // 팩트 검증: 두 다리(USD/KRW·USD/BRL)를 각각 범위 검사하고, 한 쪽이라도
  // 이상한 날짜는 통째로 버려 파생 원/헤알까지 정합성을 지킨다.
  const okIdx: number[] = [];
  series.dates.forEach((d, i) => {
    const a = sanitizeSeries([d], [series.usdKrw[i]], BOUNDS.usdKrw);
    const b = sanitizeSeries([d], [series.usdBrl[i]], BOUNDS.usdBrl);
    if (a.values.length && b.values.length) okIdx.push(i);
  });
  const dropped = series.dates.length - okIdx.length;
  const dates = okIdx.map((i) => series.dates[i]);
  const usdKrw = okIdx.map((i) => series.usdKrw[i]);
  const usdBrl = okIdx.map((i) => series.usdBrl[i]);
  const krwBrl = okIdx.map(
    (i) => Math.round((series.usdKrw[i] / series.usdBrl[i]) * 100) / 100
  );

  return NextResponse.json({
    dates,
    usdKrw,
    usdBrl,
    krwBrl,
    dropped,
    source: "Frankfurter (ECB reference rates)",
  });
}
