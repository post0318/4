import { NextResponse } from "next/server";
import { pickGlobalBrazilNews } from "@/lib/server/brazilNews";
import {
  MIN_TEXT,
  SUMMARY_PROMPT,
  articleInput,
  checkIngestToken,
  getCachedSummaries,
  prepareArticle,
} from "@/lib/server/newsSummary";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * 오라클 요약 스케줄러용 — 아직 요약이 없는 글로벌 뉴스와, 그대로 모델에 넣을 입력문.
 * Authorization: Bearer NEWS_INGEST_TOKEN. 화면 목록 최대치(9건)를 본다.
 * 응답: { prompt, items: [{ link, title, url, fromText, input }] }
 */
export async function GET(req: Request) {
  if (!checkIngestToken(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const raw = await pickGlobalBrazilNews(9);
  const cached = await getCachedSummaries(raw.map((r) => r.link));
  const todo = raw.filter((_, i) => !cached[i]);
  const items = await Promise.all(
    todo.map(async (r) => {
      const a = await prepareArticle(r.link);
      const input = articleInput(r.title, a);
      return { link: r.link, title: r.title, url: a.url, fromText: a.text.length >= MIN_TEXT, input };
    })
  );
  return NextResponse.json({ prompt: SUMMARY_PROMPT, items });
}
