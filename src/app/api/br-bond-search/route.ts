import { NextResponse } from "next/server";
import { getLatestNtnF } from "@/lib/server/brazilBondData";
import { getNtnfMeta, ntnfDisplayName } from "@/lib/ntnfMeta";
import { snapshotFreshness } from "@/lib/server/sanity";

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
 *
 * buyYieldLive/sellYieldLive: true면 해당 값이 CSV가 아니라 거래 플랫폼
 * 실시간 보정값(liveAsOfDate 기준)이다(오너 지시, 2026-09-24 — CSV 정지 대응).
 */
export async function GET() {
  const { asOfDate, liveAsOfDate, items } = getLatestNtnF();
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
        buyYieldLive: b.buyLive === true,
        sellYieldLive: b.sellLive === true,
        buyYieldEstimated: b.buyEstimated === true,
      };
    });

  // 일일 갱신이 실패해도 앱은 옛 금리로 계속 계산하므로, 경과일수·노후 여부를
  // 같이 내려 화면이 경고를 띄우게 한다(감사 ⑤ 중3).
  // CSV가 며칠 늦어도 실시간 기준일이 최근이면 최신으로 본다(둘 중 더 늦은 날짜 기준)
  const newest = liveAsOfDate && liveAsOfDate > asOfDate ? liveAsOfDate : asOfDate;
  const { ageDays, stale } = snapshotFreshness(newest);
  return NextResponse.json({ asOfDate, ageDays, stale, liveAsOfDate, bonds });
}
