"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { FxRatePanel } from "@/components/FxRatePanel";
import { BrazilBriefing } from "@/components/BrazilBriefing";
import { BondOrderTable, type BondRow } from "@/components/BondOrderTable";
import { OrderReview, type PendingLine } from "@/components/OrderReview";
import {
  computeNtnfPu,
  getOrderSettlementDate,
  toISODate,
  today,
} from "@/lib/ntnfPricing";
import { computeOrder, isValidOrderInputs } from "@/lib/quantity";
import type { BondItem, BondSearchResponse, FxRates } from "@/lib/types";

export function OrderConsole() {
  const [fx, setFx] = useState<FxRates | null>(null);
  const [fxLoading, setFxLoading] = useState(true);
  const [fxError, setFxError] = useState<string | null>(null);

  const [bonds, setBonds] = useState<BondItem[]>([]);
  const [asOfDate, setAsOfDate] = useState<string | null>(null);
  const [bondLoading, setBondLoading] = useState(true);
  const [bondError, setBondError] = useState<string | null>(null);

  const [checkedKeys, setCheckedKeys] = useState<string[]>([]);
  const [amounts, setAmounts] = useState<Record<string, string>>({});
  // 달러($) override. 값이 없으면 원화투자금액 ÷ 환율 자동값을 쓴다.
  const [usdOverrides, setUsdOverrides] = useState<Record<string, string>>({});
  // 실제 주문수량 override. 값이 없으면 매수가능수량을 그대로 쓴다.
  const [orderQtys, setOrderQtys] = useState<Record<string, string>>({});
  const [defaultTo, setDefaultTo] = useState("");
  const [defaultCc, setDefaultCc] = useState("");

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
        const d: { defaultTo?: string; defaultCc?: string } = await fetch(
          "/api/send-order"
        ).then((r) => r.json());
        if (!cancelled && d.defaultTo) setDefaultTo(d.defaultTo);
        if (!cancelled && d.defaultCc) setDefaultCc(d.defaultCc);
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

  const toggle = useCallback((key: string) => {
    setCheckedKeys((prev) =>
      prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]
    );
  }, []);

  const changeAmount = useCallback((key: string, value: string) => {
    setAmounts((prev) => ({ ...prev, [key]: value }));
  }, []);

  const changeUsd = useCallback((key: string, value: string) => {
    setUsdOverrides((prev) => ({ ...prev, [key]: value }));
  }, []);

  const changeOrderQty = useCallback((key: string, value: string) => {
    setOrderQtys((prev) => ({ ...prev, [key]: value }));
  }, []);

  const rows: BondRow[] = useMemo(() => {
    return bonds.map((bond) => {
      const key = bond.maturityDate;
      const checked = checkedKeys.includes(key);
      const krwInput = amounts[key] ?? "";
      const pu =
        bond.buyYieldPct === null
          ? null
          : computeNtnfPu(bond.maturityDate, bond.buyYieldPct, settlement);

      // 달러($): 원화투자금액 ÷ 환율 자동값, 있으면 사용자 수정값
      const krwNum = Number(krwInput);
      const autoUsd =
        fx && krwInput !== "" && krwNum > 0
          ? Math.round((krwNum / fx.usdKrw) * 100) / 100
          : null;
      const usdOverride = usdOverrides[key];
      const usdEdited = usdOverride !== undefined && usdOverride !== "";
      const usdInput = usdEdited
        ? usdOverride
        : autoUsd !== null
          ? autoUsd.toFixed(2)
          : "";
      const effectiveUsd = usdEdited ? Number(usdOverride) : autoUsd;

      let order = null;
      if (checked && fx && pu !== null && effectiveUsd) {
        const inputs = {
          usdAmount: effectiveUsd,
          usdKrw: fx.usdKrw,
          usdBrl: fx.usdBrl,
          pu,
        };
        if (isValidOrderInputs(inputs)) order = computeOrder(inputs);
      }

      // 실제 주문수량: 손대기 전엔 매수가능수량을 따라간다
      const qtyOverride = orderQtys[key];
      const orderQtyInput =
        qtyOverride !== undefined
          ? qtyOverride
          : order
            ? String(order.quantity)
            : "";
      const effectiveQty = !order
        ? 0
        : qtyOverride !== undefined && qtyOverride !== ""
          ? Math.trunc(Number(qtyOverride))
          : order.quantity;
      const orderQtyExceeds = !!order && effectiveQty > order.quantity;

      return {
        key,
        bond,
        checked,
        krwInput,
        usdInput,
        usdEdited,
        pu,
        order,
        orderQtyInput,
        effectiveQty,
        orderQtyExceeds,
      };
    });
  }, [bonds, checkedKeys, amounts, usdOverrides, orderQtys, fx, settlement]);

  const pendingLines: PendingLine[] = useMemo(() => {
    return rows
      .filter(
        (r) =>
          r.checked &&
          r.order &&
          r.effectiveQty >= 1 &&
          !r.orderQtyExceeds &&
          r.pu !== null &&
          r.bond.buyYieldPct !== null
      )
      .map((r) => {
        const order = r.order as NonNullable<BondRow["order"]>;
        return {
          isin: r.bond.isin ?? "",
          isinVerified: r.bond.isinVerified,
          nameKo: r.bond.nameKo,
          namePt: r.bond.namePt,
          maturityDate: r.bond.maturityDate,
          buyYieldPct: r.bond.buyYieldPct as number,
          krwAmount: Number(r.krwInput),
          usdAmount: order.usdAmount,
          pu: r.pu as number,
          quantity: order.quantity,
          orderQuantity: r.effectiveQty,
        };
      });
  }, [rows]);

  const incompleteCount = useMemo(
    () =>
      rows.filter(
        (r) =>
          r.checked &&
          (!r.order || r.effectiveQty < 1 || r.orderQtyExceeds)
      ).length,
    [rows]
  );

  return (
    <div className="mx-auto grid max-w-6xl gap-4 p-4 sm:p-6">
      <header>
        <h1 className="text-lg font-bold text-zinc-900 dark:text-zinc-100">
          브라질 트레이딩
        </h1>
        <p className="text-xs text-zinc-500 dark:text-zinc-400">
          주문일 {orderDate} · 결제일 {settlementDate} (D+0 브라질 영업일)
        </p>
      </header>

      <FxRatePanel rates={fx} loading={fxLoading} error={fxError} onRefresh={loadFx} />

      <BrazilBriefing />

      <BondOrderTable
        rows={rows}
        asOfDate={asOfDate}
        loading={bondLoading}
        error={bondError}
        fxReady={!!fx}
        settlementDate={settlementDate}
        onToggle={toggle}
        onAmountChange={changeAmount}
        onUsdChange={changeUsd}
        onOrderQtyChange={changeOrderQty}
      />

      <OrderReview
        lines={pendingLines}
        incompleteCount={incompleteCount}
        fx={fx}
        defaultTo={defaultTo}
        defaultCc={defaultCc}
      />

      <footer className="pb-8 text-[11px] text-zinc-400">
        환율은 Frankfurter(ECB) 중간환율이며 실제 체결 환율·스프레드와 다릅니다.
        시세는 레포에 커밋된 주간 스냅샷 기준입니다. 발송 전 반드시 값을
        확인하세요.
      </footer>
    </div>
  );
}
