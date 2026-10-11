import { NextResponse } from "next/server";
import { pickGlobalBrazilNews } from "@/lib/server/brazilNews";
import {
  SUMMARY_PROMPT,
  articleInput,
  basisOf,
  checkIngestToken,
  getCachedSummaries,
  needsSummary,
  prepareArticle,
} from "@/lib/server/newsSummary";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * 오라클 요약 스케줄러용 — 아직 요약이 없는(또는 옛 "요약 불가"라 다른 매체로 다시 해볼)
 * 글로벌 뉴스와, 그대로 모델에 넣을 입력문. Authorization: Bearer NEWS_INGEST_TOKEN.
 * 화면 목록 최대치(9건)를 본다.
 * 응답: { prompt, items: [{ link, title, url, fromText, basis, sources, input }] }
 */
export async function GET(req: Request) {
  if (!checkIngestToken(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const raw = await pickGlobalBrazilNews(9);
  const cached = await getCachedSummaries(raw.map((r) => r.link));
  const todo = raw.filter((_, i) => needsSummary(cached[i]));
  const items = await Promise.all(
    todo.map(async (r) => {
      const a = await prepareArticle(r.link, r.title);
      const basis = basisOf(a);
      return {
        link: r.link,
        title: r.title,
        url: a.url,
        fromText: basis !== "link",
        basis,
        sources: a.alt.map(({ url, source }) => ({ url, source })),
        input: articleInput(r.title, a),
      };
    })
  );
  return NextResponse.json({ prompt: SUMMARY_PROMPT, items });
}
