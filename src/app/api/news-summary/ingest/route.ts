import { NextResponse } from "next/server";
import {
  type Basis,
  SUMMARY_VERSION,
  checkIngestToken,
  parseSummary,
  saveSummary,
} from "@/lib/server/newsSummary";

const BASES: Basis[] = ["article", "other", "link"];
const isHttp = (u: unknown): u is string => typeof u === "string" && /^https?:\/\//.test(u);

/**
 * 오라클 요약 스케줄러가 만든 요약을 넣는다. Authorization: Bearer NEWS_INGEST_TOKEN.
 * body: { link, url, fromText, basis, sources, output } — pending 항목 그대로 + output(모델
 * 출력 원문, JSON 은 여기서 파싱). 모델이 못 읽었다고 답하면(bullets 빈 배열) 그 기사는
 * "요약 불가"로 확정한다(다른 매체까지 시도했으므로 altTried).
 */
export async function POST(req: Request) {
  if (!checkIngestToken(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const body = (await req.json().catch(() => null)) as
    | {
        link?: unknown;
        url?: unknown;
        fromText?: unknown;
        basis?: unknown;
        sources?: unknown;
        output?: unknown;
      }
    | null;
  const link = typeof body?.link === "string" ? body.link : "";
  const url = isHttp(body?.url) ? body.url : link;
  const parsed = typeof body?.output === "string" ? parseSummary(body.output) : null;
  if (!link || !parsed) {
    return NextResponse.json({ error: "bad request" }, { status: 400 });
  }
  const basis = BASES.includes(body?.basis as Basis) ? (body?.basis as Basis) : undefined;
  const sources = Array.isArray(body?.sources)
    ? (body.sources as { url?: unknown; source?: unknown }[])
        .filter((s) => isHttp(s?.url))
        .slice(0, 3)
        .map((s) => ({ url: s.url as string, source: String(s.source ?? "").slice(0, 80) }))
    : [];
  await saveSummary(link, {
    ...parsed,
    url,
    fromText: body?.fromText === true,
    by: "oracle",
    basis,
    sources: basis === "other" && sources.length ? sources : undefined,
    altTried: true,
    v: SUMMARY_VERSION,
  });
  return NextResponse.json({ ok: true, unreadable: parsed.bullets.length === 0 });
}
