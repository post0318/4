import { NextResponse } from "next/server";
import { fetchFxSeries } from "@/lib/server/fxRate";

// 12시간마다 재검증 (ECB는 하루 1회 갱신)
export const revalidate = 43200;

/**
 * 환율 3년치 일간 추이 (원/달러·달러/헤알·원/헤알).
 * Frankfurter 시계열(ECB 기준, 무인증). 원/헤알은 usdKrw/usdBrl 파생값이다.
 */
export async function GET() {
  const to = new Date();
  const from = new Date(to);
  from.setFullYear(from.getFullYear() - 3);
  const iso = (d: Date) => d.toISOString().slice(0, 10);

  const series = await fetchFxSeries(iso(from), iso(to));
  if (!series || series.dates.length === 0) {
    return NextResponse.json(
      { error: "환율 추이를 불러오지 못했습니다." },
      { status: 502 }
    );
  }

  const krwBrl = series.usdKrw.map((k, i) =>
    Math.round((k / series.usdBrl[i]) * 100) / 100
  );

  return NextResponse.json({
    dates: series.dates,
    usdKrw: series.usdKrw,
    usdBrl: series.usdBrl,
    krwBrl,
  });
}
