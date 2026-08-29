import { NextRequest, NextResponse } from "next/server";
import { fetchCountryRating, formatCountryRating } from "@/lib/cashflow/server/countryRating";

// 국가신용등급은 자주 바뀌지 않음 — 12시간 재검증
export const revalidate = 43200;

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
