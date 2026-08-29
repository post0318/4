import { NextResponse } from "next/server";
import { fetchGlobalBrazilNews } from "@/lib/server/brazilNews";
import { fetchBomDiaNews } from "@/lib/server/bomDiaNews";

// 30분마다 재검증
export const revalidate = 1800;

/**
 * 브라질 현지 뉴스 + 브라질 관련 글로벌 뉴스.
 * - items: 좋은아침뉴스(상파울루 한인신문)가 한국어로 취재한 현지 뉴스. 번역 없음.
 * - global: 브라질 관련 영문 뉴스, 제목 자동 번역. 현지 뉴스 건수의 약 1.4배
 *   (현지 5건이면 7건), 최소 5건·최대 9건.
 */
export async function GET() {
  const items = await fetchBomDiaNews(5);
  // 현지 뉴스는 요약 1줄이 붙어 항목이 더 길다. 제목만 있는 글로벌은 현지 건수의
  // 약 1.4배로 채워 두 칼럼 높이를 맞춘다(현지 5건이면 7건). 최소 5건·최대 9건.
  const globalCount = Math.min(9, Math.max(5, Math.round(items.length * 1.4)));
  const global = await fetchGlobalBrazilNews(globalCount);
  if (items.length === 0 && global.length === 0) {
    return NextResponse.json(
      { error: "뉴스를 불러오지 못했습니다." },
      { status: 502 }
    );
  }
  return NextResponse.json({ items, global });
}
