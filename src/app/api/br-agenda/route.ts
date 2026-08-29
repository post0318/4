import { NextResponse } from "next/server";
import { fetchBrazilAgenda } from "@/lib/server/brazilAgenda";

// 12시간마다 재검증
export const revalidate = 43200;

/**
 * 브라질 주요일정 — 조회일 기준 15일 전 발표치 ~ 향후 2개월 예정의 중요 경제지표
 * (IBGE 발표일 + Focus 예상치 + SGS 발표치)와 시장 휴장일.
 */
export async function GET() {
  const items = await fetchBrazilAgenda(15, 60);
  return NextResponse.json({ items });
}
