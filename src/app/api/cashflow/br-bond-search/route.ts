import { NextResponse } from "next/server";
import { getLatestNtnF } from "@/lib/server/brazilBondData";
import { snapshotFreshness } from "@/lib/server/sanity";

/**
 * 브라질채권검색 목록. 트레이딩 탭과 **같은** 스냅샷(src/lib/server/ntnf-snapshot.json)
 * 을 반환한다 — 예전에는 현금흐름 전용 사본을 읽어 주간 갱신에서 빠져 있었다
 * (감사 ⑤ 중1). 요청 시점에 외부 소스를 받지 않으므로 항상 즉시 응답한다.
 */
export async function GET() {
  const { asOfDate, items } = getLatestNtnF();
  const { ageDays, stale } = snapshotFreshness(asOfDate);
  return NextResponse.json({ asOfDate, ageDays, stale, bonds: items });
}
