import { NextResponse } from "next/server";
import { fetchBrazilNews } from "@/lib/server/brazilNews";

// 30분마다 재검증
export const revalidate = 1800;

/**
 * 브라질 현지 뉴스(경제·정치·사회) 5건, 제목 한글 번역 포함.
 */
export async function GET() {
  const items = await fetchBrazilNews(5);
  if (items.length === 0) {
    return NextResponse.json(
      { error: "뉴스를 불러오지 못했습니다." },
      { status: 502 }
    );
  }
  return NextResponse.json({ items });
}
