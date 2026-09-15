import { NextRequest, NextResponse } from "next/server";
import { fetchCountryRating, formatCountryRating } from "@/lib/cashflow/server/countryRating";

// 쿼리(slug)를 읽어 동적 라우트라 `revalidate` 세그먼트 설정이 적용되지 않는다
// (Next 16: GET 핸들러는 기본 동적, 요청 객체를 읽으면 정적 캐시 불가).
// 캐싱은 countryRating.ts의 모듈 메모리 캐시로 대체한다 (감사 ⑤ 낮음).

export async function GET(request: NextRequest) {
  const slug = request.nextUrl.searchParams.get("slug");
  if (!slug) {
    return NextResponse.json({ error: "slug 파라미터가 필요합니다." }, { status: 400 });
  }
  try {
    const rating = await fetchCountryRating(slug);
    const formatted = rating ? formatCountryRating(rating) : null;
    return NextResponse.json({ rating: formatted });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "조회 실패" },
      { status: 502 }
    );
  }
}
