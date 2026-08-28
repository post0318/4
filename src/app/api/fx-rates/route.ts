import { NextResponse } from "next/server";
import { fetchFxRate } from "@/lib/server/fxRate";

/**
 * 원/달러·달러/헤알 환율을 한 번에 조회한다 (요구사항 1).
 * 원/헤알은 usdKrw/usdBrl 로 파생한다(표시값과 수량계산을 일치시키기 위해).
 * 소스: Frankfurter.dev(ECB 기준, 무인증). 영업일 1회 갱신되는 참고용 환율이다.
 */
export async function GET() {
  try {
    const [usdKrw, usdBrl] = await Promise.all([
      fetchFxRate("USD", "KRW"),
      fetchFxRate("USD", "BRL"),
    ]);

    if (typeof usdKrw !== "number" || typeof usdBrl !== "number") {
      return NextResponse.json(
        { error: "환율 조회에 실패했습니다." },
        { status: 502 }
      );
    }

    return NextResponse.json({
      usdKrw,
      usdBrl,
      krwBrl: usdKrw / usdBrl,
      asOf: new Date().toISOString(),
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "환율 조회 실패" },
      { status: 502 }
    );
  }
}
