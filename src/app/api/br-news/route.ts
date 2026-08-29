import { NextResponse } from "next/server";
import {
  fetchBrazilNews,
  fetchGlobalBrazilNews,
} from "@/lib/server/brazilNews";

// 30분마다 재검증
export const revalidate = 1800;

/**
 * 브라질 현지 뉴스(경제·정치·사회) + 브라질 관련 글로벌 뉴스, 각 5건.
 * 제목은 한글 번역 + 왕복검증.
 */
export async function GET() {
  const [items, global] = await Promise.all([
    fetchBrazilNews(5),
    fetchGlobalBrazilNews(5),
  ]);
  if (items.length === 0 && global.length === 0) {
    return NextResponse.json(
      { error: "뉴스를 불러오지 못했습니다." },
      { status: 502 }
    );
  }
  return NextResponse.json({ items, global });
}
