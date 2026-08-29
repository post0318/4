import { NextResponse } from "next/server";
import { fetchBrazilAgenda } from "@/lib/server/brazilAgenda";

// 12시간마다 재검증
export const revalidate = 43200;

/**
 * 브라질 주요일정 — 조회일 기준 향후 약 1개월의 경제지표 발표(IBGE)·시장 휴장일.
 */
export async function GET() {
  const items = await fetchBrazilAgenda(31);
  return NextResponse.json({ items });
}
