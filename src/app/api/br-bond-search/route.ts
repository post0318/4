import { NextResponse } from "next/server";
import { getLatestNtnF } from "@/lib/server/brazilBondData";
import { getNtnfMeta, ntnfDisplayName } from "@/lib/ntnfMeta";
import { snapshotFreshness } from "@/lib/server/sanity";

/**
 * 브라질국채(NTN-F) 목록 (요구사항 2).
 * 레포에 커밋된 스냅샷(src/lib/server/ntnf-snapshot.json)을 그대로 반환하되,
 * ISIN·종목명 메타데이터를 머지한다. 스냅샷 갱신은 GitHub Actions(주간) → 재배포.
 *
 * 매수·매도수익률은 스냅샷의 buyRate/sellRate = 같은 기준일의 중간값 ∓ 호가차/2
 * (오너 지시, 2026-10-09 — 금리 차트와 같은 기준). 출처 조합은 quoteNote 로 내린다.
 * 매수 쪽은 Tesouro 정의상 Taxa Compra(투자자 매수 금리)가 매도(Taxa Venda)보다
 * 낮으므로 중간값 − 호가차/2 다. 공시 PU Compra 는 Taxa Compra + D+1 결제로 재현된다.
 */
export async function GET() {
  const { asOfDate, liveAsOfDate, quoteAsOfDate, items } = getLatestNtnF();
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
        midYieldPct: b.midRate,
        spreadPct: b.spread,
        quoteDate: b.quoteDate,
        quoteNote: b.note,
        buyYieldEstimated: b.estimated,
      };
    });

  // 일일 갱신이 실패해도 앱은 옛 금리로 계속 계산하므로, 경과일수·노후 여부를
  // 같이 내려 화면이 경고를 띄우게 한다(감사 ⑤ 중3). 기준은 종목 시세 기준일 중 가장 이른 날.
  const quoteDay = quoteAsOfDate ?? asOfDate;
  const { ageDays, stale } = snapshotFreshness(quoteDay);
  return NextResponse.json({ asOfDate: quoteDay, csvAsOfDate: asOfDate, ageDays, stale, liveAsOfDate, bonds });
}
