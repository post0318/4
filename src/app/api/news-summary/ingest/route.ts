import { NextResponse } from "next/server";
import { checkIngestToken, parseSummary, saveSummary } from "@/lib/server/newsSummary";

/**
 * 오라클 요약 스케줄러가 만든 요약을 넣는다. Authorization: Bearer NEWS_INGEST_TOKEN.
 * body: { link, url, fromText, output } — output 은 모델 출력 원문(JSON 을 여기서 파싱).
 * 모델이 본문을 못 읽었다고 답하면(bullets 빈 배열) 그 기사는 "요약 불가"로 확정한다.
 */
export async function POST(req: Request) {
  if (!checkIngestToken(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const body = (await req.json().catch(() => null)) as
    | { link?: unknown; url?: unknown; fromText?: unknown; output?: unknown }
    | null;
  const link = typeof body?.link === "string" ? body.link : "";
  const url = typeof body?.url === "string" && /^https?:\/\//.test(body.url) ? body.url : link;
  const parsed = typeof body?.output === "string" ? parseSummary(body.output) : null;
  if (!link || !parsed) {
    return NextResponse.json({ error: "bad request" }, { status: 400 });
  }
  await saveSummary(link, { ...parsed, url, fromText: body?.fromText === true, by: "oracle" });
  return NextResponse.json({ ok: true, unreadable: parsed.bullets.length === 0 });
}
