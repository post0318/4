import { NextResponse } from "next/server";
import { getLatestNtnF } from "@/lib/server/brazilBondData";
import { getNtnfMeta, ntnfDisplayName } from "@/lib/ntnfMeta";

/**
 * 브라질국채(NTN-F) 목록 (요구사항 2).
 * 레포에 커밋된 스냅샷(src/lib/server/ntnf-snapshot.json)을 그대로 반환하되,
 * ISIN·종목명 메타데이터를 머지한다. 스냅샷 갱신은 GitHub Actions(주간) → 재배포.
 *
 * 매수수익률(buyYieldPct)은 스냅샷의 buyRate(Taxa Compra Manhã)를 쓴다.
 * Tesouro Direto 정의상 Taxa Compra = 투자자가 매수할 때 금리, Taxa Venda =
 * 투자자가 만기 전 국고에 되팔 때 금리(항상 0.12%p 높음). 공시 PU Compra는
 * Taxa Compra + D+1 결제로 정확히 재현된다(감사 ⑤ 높음1). 예전에는 Venda를
 * 써서 PU가 낮게, 수량이 최대 0.6% 많게 산출됐다.
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
        buyYieldPct: b.buyRate,
        sellYieldPct: b.sellRate,
      };
    });

  return NextResponse.json({ asOfDate, bonds });
}
