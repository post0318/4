import { NextResponse } from "next/server";
import { getLatestNtnF } from "@/lib/server/brazilBondData";
import { getNtnfMeta, ntnfDisplayName } from "@/lib/ntnfMeta";

/**
 * 브라질국채(NTN-F) 목록 (요구사항 2).
 * 레포에 커밋된 스냅샷(src/lib/server/ntnf-snapshot.json)을 그대로 반환하되,
 * ISIN·종목명 메타데이터를 머지한다. 스냅샷 갱신은 GitHub Actions(주간) → 재배포.
 *
 * 매수수익률(buyYieldPct)은 스냅샷의 sellRate(Taxa Venda Manhã = 테조우로가
 * 투자자에게 파는 금리 = 투자자 매수 기준)를 쓴다. buyRate(Taxa Compra)는 투자자가
 * 되파는(매도) 쪽이라 매수 단가 계산에 맞지 않는다.
 */
export async function GET() {
  const { asOfDate, items } = getLatestNtnF();
  const today = new Date().toISOString().slice(0, 10);

  const bonds = items
    .filter((b) => b.maturityDate >= today)
    .map((b) => {
      const meta = getNtnfMeta(b.maturityDate);
      return {
        maturityDate: b.maturityDate,
        nameKo: meta?.nameKo ?? ntnfDisplayName(b.maturityDate),
        namePt:
          meta?.namePt ??
          `Tesouro Prefixado com Juros Semestrais ${b.maturityDate.slice(0, 4)}`,
        isin: meta?.isin ?? null,
        isinVerified: meta?.isinVerified ?? false,
        buyYieldPct: b.sellRate,
        sellYieldPct: b.buyRate,
      };
    });

  return NextResponse.json({ asOfDate, bonds });
}
