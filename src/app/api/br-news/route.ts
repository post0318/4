import { NextResponse } from "next/server";
import { fetchGlobalBrazilNews } from "@/lib/server/brazilNews";
import { fetchBomDiaNews } from "@/lib/server/bomDiaNews";
import { mergeNewsArchive } from "@/lib/server/newsArchive";
import { getCachedSummaries } from "@/lib/server/newsSummary";

// 30분마다 재검증
export const revalidate = 1800;
// 번역(무인증 Google/MyMemory)이 느려질 수 있어 여유 있게
export const maxDuration = 25;

/**
 * 브라질 현지 뉴스 + 브라질 관련 글로벌 뉴스 — 각각 보관함(최근 7일·최대 30건, 최신순)과
 * 합쳐 내보낸다. 화면은 5건씩 페이지로 넘긴다.
 * - items: 좋은아침뉴스(상파울루 한인신문)가 한국어로 취재한 현지 뉴스. 번역 없음.
 * - global: 브라질 관련 영문 뉴스, 제목 자동 번역(+ 클릭 요약용 sig). excerpt 는
 *   오라클이 만든 요약의 첫 문장 — 화면 미리보기 1줄(아직 없으면 생략, 다음 재검증 때 채워짐).
 *
 * 한쪽이 실패해도 다른 쪽은 내보낸다.
 */
export async function GET() {
  const [localFresh, globalFresh] = await Promise.all([
    fetchBomDiaNews(10).catch(() => []),
    fetchGlobalBrazilNews(9).catch(() => []),
  ]);
  const [items, globalAll] = await Promise.all([
    mergeNewsArchive("local", localFresh),
    mergeNewsArchive("global", globalFresh),
  ]);

  const summaries = await getCachedSummaries(globalAll.map((g) => g.link)).catch(() => []);
  const global = globalAll.map((g, i) => {
    const s = summaries[i];
    return s?.bullets.length ? { ...g, excerpt: s.bullets[0] } : g;
  });

  if (items.length === 0 && global.length === 0) {
    return NextResponse.json(
      { error: "뉴스를 불러오지 못했습니다." },
      { status: 502 }
    );
  }
  return NextResponse.json({ items, global });
}
