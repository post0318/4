import { NextRequest, NextResponse } from "next/server";
import { fetchFxRate } from "@/lib/cashflow/server/fxRate";

export async function GET(request: NextRequest) {
  const base = request.nextUrl.searchParams.get("base");
  const quote = request.nextUrl.searchParams.get("quote");
  if (!base || !quote) {
    return NextResponse.json(
      { error: "base/quote 파라미터가 필요합니다." },
      { status: 400 }
    );
  }
  try {
    const rate = await fetchFxRate(base, quote);
    return NextResponse.json({ rate });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "조회 실패" },
      { status: 502 }
    );
  }
}
