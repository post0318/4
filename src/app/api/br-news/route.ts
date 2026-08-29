import { NextResponse } from "next/server";
import { fetchGlobalBrazilNews } from "@/lib/server/brazilNews";
import { fetchBomDiaNews } from "@/lib/server/bomDiaNews";

// 30분마다 재검증
export const revalidate = 1800;
// 번역(무인증 Google/MyMemory)이 느려질 수 있어 여유 있게
export const maxDuration = 25;

/**
 * 브라질 현지 뉴스 + 브라질 관련 글로벌 뉴스.
 * - items: 좋은아침뉴스(상파울루 한인신문)가 한국어로 취재한 현지 뉴스. 번역 없음.
 * - global: 브라질 관련 영문 뉴스, 제목 자동 번역. 현지 뉴스 건수의 약 1.4배
 *   (현지 5건이면 7건), 최소 5건·최대 9건.
 *
 * 한쪽이 실패해도 다른 쪽은 내보낸다.
 */
export async function GET() {
  const items = await fetchBomDiaNews(5).catch(() => []);
  const globalCount = Math.min(9, Math.max(5, Math.round(items.length * 1.4)));
  const global = await fetchGlobalBrazilNews(globalCount).catch(() => []);

  if (items.length === 0 && global.length === 0) {
    return NextResponse.json(
      { error: "뉴스를 불러오지 못했습니다." },
      { status: 502 }
    );
  }
  return NextResponse.json({ items, global });
}
