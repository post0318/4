import { NextResponse } from "next/server";
import { getLatestNtnF } from "@/lib/cashflow/server/brazilBondData";

/**
 * 브라질채권검색 목록. 레포에 커밋된 스냅샷(ntnf-snapshot.json)을 그대로
 * 반환한다 — 요청 시점에 외부 소스를 받지 않으므로 항상 즉시 응답한다.
 * 스냅샷 갱신은 GitHub Actions(주간) → 재배포 경로로만 이뤄진다.
 */
export async function GET() {
  const { asOfDate, items } = getLatestNtnF();
  return NextResponse.json({ asOfDate, bonds: items });
}
