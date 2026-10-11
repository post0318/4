import { NextResponse } from "next/server";
import { getNewsSummary } from "@/lib/server/newsSummary";

// 저장본이 없고 클릭 생성(A)이 켜져 있으면 원문 수집(~18s) + Gemini(25s)
export const maxDuration = 60;

/**
 * 글로벌 뉴스 클릭 요약(팝업). body: { link, sig?, title } — /api/br-news 의 global 항목
 * 그대로. 저장본(오라클이 만든 것 등)을 돌려주고, 없으면 pending. 공개 API.
 */
export async function POST(req: Request) {
  const body = (await req.json().catch(() => null)) as
    | { link?: unknown; sig?: unknown; title?: unknown }
    | null;
  const link = typeof body?.link === "string" ? body.link.slice(0, 2000) : "";
  if (!link) return NextResponse.json({ ok: false, reason: "error" }, { status: 400 });
  const sig = typeof body?.sig === "string" ? body.sig : "";
  const title = typeof body?.title === "string" ? body.title.slice(0, 300) : "";
  return NextResponse.json(await getNewsSummary(link, sig, title));
}
