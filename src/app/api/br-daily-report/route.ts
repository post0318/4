import { NextResponse } from "next/server";
import { fetchKobrasDailyReport } from "@/lib/server/kobrasDailyReport";

// 1시간마다 재검증 (리포트는 하루 1회, 평일 오전 갱신)
export const revalidate = 3600;

/**
 * 한국브라질소사이어티(KOBRAS) 「브라질 데일리 리포트」 최신호.
 * 핵심 분석([KOBRAS Daily Brief])과 큐레이션 기사 목록만 전달한다.
 */
export async function GET() {
  const report = await fetchKobrasDailyReport();
  if (!report) {
    return NextResponse.json(
      { error: "데일리 리포트를 불러오지 못했습니다." },
      { status: 502 }
    );
  }
  return NextResponse.json({ report });
}
