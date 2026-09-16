import { NextRequest, NextResponse } from "next/server";
import { fetchFxRate } from "@/lib/server/fxRate";

// 쿼리(base/quote)를 읽어 동적 라우트라 `revalidate` 세그먼트 설정이 적용되지
// 않는다(Next 16: GET 핸들러는 기본 동적, 요청 객체를 읽으면 정적 캐시 불가).
// 호출 빈도가 낮아(종목 선택 시 1회) 별도 캐시 없이 둔다 (감사 ⑤ 낮음).

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
