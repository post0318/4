"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { FxRatePanel } from "@/components/FxRatePanel";
import { BondSelector } from "@/components/BondSelector";
import { OrderForm } from "@/components/OrderForm";
import { OrderReview } from "@/components/OrderReview";
import {
  computeNtnfPu,
  getOrderSettlementDate,
  toISODate,
  today,
} from "@/lib/ntnfPricing";
import { computeOrder, isValidOrderInputs } from "@/lib/quantity";
import type { OrderPayload } from "@/lib/orderEmail";
import type { BondItem, BondSearchResponse, FxRates } from "@/lib/types";

export function OrderConsole() {
  const [fx, setFx] = useState<FxRates | null>(null);
  const [fxLoading, setFxLoading] = useState(true);
  const [fxError, setFxError] = useState<string | null>(null);

  const [bonds, setBonds] = useState<BondItem[]>([]);
  const [asOfDate, setAsOfDate] = useState<string | null>(null);
  const [bondLoading, setBondLoading] = useState(true);
  const [bondError, setBondError] = useState<string | null>(null);
  const [selected, setSelected] = useState<BondItem | null>(null);

  const [krwInput, setKrwInput] = useState("");
  const [defaultTo, setDefaultTo] = useState("");

  const applyFxResponse = useCallback((d: FxRates & { error?: string }) => {
    if (d.error || typeof d.usdKrw !== "number") {
      setFxError(d.error ?? "환율 조회 실패");
      setFx(null);
      return;
    }
    setFxError(null);
    setFx({ usdKrw: d.usdKrw, usdBrl: d.usdBrl, krwBrl: d.krwBrl, asOf: d.asOf });
  }, []);

  const loadFx = useCallback(() => {
    setFxLoading(true);
    setFxError(null);
    fetch("/api/fx-rates")
      .then((r) => r.json())
      .then(applyFxResponse)
      .catch(() => setFxError("환율 조회 중 오류가 발생했습니다."))
      .finally(() => setFxLoading(false));
  }, [applyFxResponse]);

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      try {
        const d = await fetch("/api/fx-rates").then((r) => r.json());
        if (!cancelled) applyFxResponse(d);
      } catch {
        if (!cancelled) setFxError("환율 조회 중 오류가 발생했습니다.");
      } finally {
        if (!cancelled) setFxLoading(false);
      }

      try {
        const d: BondSearchResponse & { error?: string } = await fetch(
          "/api/br-bond-search"
        ).then((r) => r.json());
        if (!cancelled) {
          if (d.error || !Array.isArray(d.bonds)) {
            setBondError(d.error ?? "종목 조회 실패");
          } else {
            setBonds(d.bonds);
            setAsOfDate(d.asOfDate ?? null);
          }
        }
      } catch {
        if (!cancelled) setBondError("종목 조회 중 오류가 발생했습니다.");
      } finally {
        if (!cancelled) setBondLoading(false);
      }

      try {
        const d: { defaultTo?: string } = await fetch("/api/send-order").then(
          (r) => r.json()
        );
        if (!cancelled && d.defaultTo) setDefaultTo(d.defaultTo);
      } catch {
        /* 기본 수신자 없음 — 무시 */
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [applyFxResponse]);

  const settlement = useMemo(() => getOrderSettlementDate(today()), []);
  const settlementDate = toISODate(settlement);
  const orderDate = toISODate(today());

  const pu = useMemo(() => {
    if (!selected || selected.buyYieldPct === null) return null;
    return computeNtnfPu(selected.maturityDate, selected.buyYieldPct, settlement);
  }, [selected, settlement]);

  const krwAmount = Number(krwInput);

  const result = useMemo(() => {
    if (!fx || pu === null) return null;
    const inputs = { krwAmount, usdKrw: fx.usdKrw, usdBrl: fx.usdBrl, pu };
    if (!isValidOrderInputs(inputs)) return null;
    return computeOrder(inputs);
  }, [fx, pu, krwAmount]);

  const waiting = useMemo(() => {
    if (!fx) return "환율을 불러오는 중입니다.";
    if (!selected) return "종목을 선택하세요.";
    if (selected.buyYieldPct === null) return "선택한 종목의 매수수익률이 없습니다.";
    if (pu === null) return "매수단가(PU)를 계산할 수 없습니다.";
    if (!krwInput || krwAmount <= 0) return "원화투자금액을 입력하세요.";
    return null;
  }, [fx, selected, pu, krwInput, krwAmount]);

  const order: OrderPayload | null = useMemo(() => {
    if (!fx || !selected || selected.buyYieldPct === null || pu === null || !result) {
      return null;
    }
    return {
      orderDate,
      settlementDate,
      bond: {
        isin: selected.isin ?? "",
        isinVerified: selected.isinVerified,
        nameKo: selected.nameKo,
        namePt: selected.namePt,
        maturityDate: selected.maturityDate,
        couponRatePct: selected.couponRatePct,
        buyYieldPct: selected.buyYieldPct,
      },
      fx: { usdKrw: fx.usdKrw, usdBrl: fx.usdBrl, krwBrl: fx.krwBrl, asOf: fx.asOf },
      amounts: {
        krwAmount,
        usdAmount: result.usdAmount,
        brlAmount: result.brlAmount,
        pu,
        quantity: result.quantity,
        brlCost: result.brlCost,
        usdCost: result.usdCost,
        krwCost: result.krwCost,
        brlLeftover: result.brlLeftover,
        krwLeftover: result.krwLeftover,
      },
    };
  }, [fx, selected, pu, result, krwAmount, orderDate, settlementDate]);

  return (
    <div className="mx-auto grid max-w-2xl gap-4 p-4 sm:p-6">
      <header>
        <h1 className="text-lg font-bold text-zinc-900 dark:text-zinc-100">
          브라질 국채 매수 프로세스 자동화
        </h1>
        <p className="text-xs text-zinc-500 dark:text-zinc-400">
          주문일 {orderDate} · 결제일 {settlementDate} (D+0 브라질 영업일)
        </p>
      </header>

      <FxRatePanel rates={fx} loading={fxLoading} error={fxError} onRefresh={loadFx} />

      <BondSelector
        bonds={bonds}
        asOfDate={asOfDate}
        loading={bondLoading}
        error={bondError}
        selected={selected}
        onSelect={setSelected}
      />

      <OrderForm
        krwInput={krwInput}
        onKrwChange={setKrwInput}
        pu={pu}
        settlementDate={settlementDate}
        result={result}
        waiting={waiting}
      />

      <OrderReview order={order} defaultTo={defaultTo} />

      <footer className="pb-8 text-[11px] text-zinc-400">
        환율은 Frankfurter(ECB) 중간환율이며 실제 체결 환율·스프레드와 다릅니다.
        시세는 레포에 커밋된 주간 스냅샷 기준입니다. 발송 전 반드시 값을
        확인하세요.
      </footer>
    </div>
  );
}
