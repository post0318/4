"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { FxRatePanel } from "@/components/FxRatePanel";
import {
  CurrencyExchange,
  deriveExchange,
  EMPTY_EXCHANGE,
  type ExchangeState,
} from "@/components/CurrencyExchange";
import { SimulationPanel } from "@/components/SimulationPanel";
import { DurationPanel } from "@/components/DurationPanel";
import { BRAZIL_FLAG_DATA_URI } from "@/lib/brazilFlag";
import { BrazilBriefing } from "@/components/BrazilBriefing";
import { CashFlowPanel } from "@/components/CashFlowPanel";
import { BondOrderTable, type BondRow } from "@/components/BondOrderTable";
import { OrderReview, type PendingLine } from "@/components/OrderReview";
import {
  computeNtnfPu,
  getOrderSettlementDate,
  toISODate,
  today,
} from "@/lib/ntnfPricing";
import {
  computeOrder,
  distributeUsdByKrwWeight,
  isValidOrderInputs,
} from "@/lib/quantity";
import type { BondItem, BondSearchResponse, FxRates } from "@/lib/types";

export function OrderConsole() {
  const [fx, setFx] = useState<FxRates | null>(null);
  const [fxLoading, setFxLoading] = useState(true);
  const [fxError, setFxError] = useState<string | null>(null);

  const [bonds, setBonds] = useState<BondItem[]>([]);
  const [asOfDate, setAsOfDate] = useState<string | null>(null);
  const [bondLoading, setBondLoading] = useState(true);
  const [bondError, setBondError] = useState<string | null>(null);

  const [tab, setTab] = useState<
    "market" | "trading" | "cashflow" | "simulation" | "duration"
  >("market");

  const [checkedKeys, setCheckedKeys] = useState<string[]>([]);
  const [amounts, setAmounts] = useState<Record<string, string>>({});
  // 환전금액(원화금액·달러금액·고시환율). 원화금액이 종목별 원화투자금액 합계의
  // 기준이 되고, 달러금액은 종목별 달러($) 자동값 배분의 기준이 된다.
  const [exchange, setExchange] = useState<ExchangeState>(EMPTY_EXCHANGE);
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

  const derivedExchange = useMemo(
    () => deriveExchange(exchange, fx?.usdKrw ?? null),
    [exchange, fx]
  );

  const rows: BondRow[] = useMemo(() => {
    // 환전금액의 달러금액이 있으면 종목별 달러($) 자동값을 원화투자금액 비중대로
    // 나눠 채운다(2자리 절사·잔동은 최대 종목 가산). 없으면 종전대로 종목별
    // 원화투자금액 ÷ 원/달러 환율.
    const useDistribution = derivedExchange.usdTotal > 0;
    const distMap = useDistribution
      ? distributeUsdByKrwWeight(
          derivedExchange.usdTotal,
          bonds
            .filter((b) => checkedKeys.includes(b.maturityDate))
            .map((b) => ({
              key: b.maturityDate,
              krw: Number(amounts[b.maturityDate] ?? "") || 0,
            }))
        )
      : null;

    return bonds.map((bond) => {
      const key = bond.maturityDate;
      const checked = checkedKeys.includes(key);
      const krwInput = amounts[key] ?? "";
      const pu =
        bond.buyYieldPct === null
          ? null
          : computeNtnfPu(bond.maturityDate, bond.buyYieldPct, settlement);

      // 달러($): 자동값(비중 배분 또는 원화 ÷ 환율), 있으면 사용자 수정값
      const krwNum = Number(krwInput);
      let autoUsd: number | null;
      if (distMap) {
        autoUsd = checked && krwNum > 0 ? (distMap[key] ?? 0) : null;
      } else {
        autoUsd =
          fx && krwInput !== "" && krwNum > 0
            ? Math.round((krwNum / fx.usdKrw) * 100) / 100
            : null;
      }
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
  }, [
    bonds,
    checkedKeys,
    amounts,
    usdOverrides,
    orderQtys,
    fx,
    settlement,
    derivedExchange,
  ]);

  // 종목별 원화투자금액 합계 vs 환전금액 원화금액 — 일치해야 발송 가능
  const checkedKrwTotal = useMemo(
    () =>
      rows.reduce(
        (s, r) => s + (r.checked ? Number(r.krwInput) || 0 : 0),
        0
      ),
    [rows]
  );
  const exchangeKrwTotal = derivedExchange.krwTotal;
  const anyChecked = useMemo(() => rows.some((r) => r.checked), [rows]);
  const krwMismatch =
    exchangeKrwTotal > 0 && anyChecked && checkedKrwTotal !== exchangeKrwTotal;

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

  const TABS = [
    { key: "market" as const, label: "시장정보" },
    { key: "trading" as const, label: "트레이딩" },
    { key: "cashflow" as const, label: "현금흐름" },
    { key: "simulation" as const, label: "시뮬레이션" },
    { key: "duration" as const, label: "금리/환율 민감도" },
  ];

  return (
    <div className="print-page mx-auto grid max-w-6xl gap-4 p-4 sm:p-6">
      <header className="print:hidden">
        <h1 className="flex items-center gap-2 text-lg font-bold text-zinc-900 dark:text-zinc-100">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={BRAZIL_FLAG_DATA_URI}
            alt=""
            aria-hidden="true"
            draggable={false}
            className="flag-wave h-4 w-auto shrink-0 select-none"
          />
          브라질 트레이딩
        </h1>
      </header>

      <div className="flex gap-1 border-b border-zinc-200 dark:border-zinc-800 print:hidden">
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => setTab(t.key)}
            aria-current={tab === t.key}
            className={`-mb-px border-b-2 px-3 py-2 text-sm font-medium transition-colors ${
              tab === t.key
                ? "border-blue-500 text-blue-600 dark:text-blue-400"
                : "border-transparent text-zinc-500 hover:text-zinc-800 dark:text-zinc-400 dark:hover:text-zinc-200"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === "market" && (
        <>
          <FxRatePanel
            rates={fx}
            loading={fxLoading}
            error={fxError}
            onRefresh={loadFx}
          />
          <BrazilBriefing />
        </>
      )}

      {tab === "trading" && (
        <>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-lg border border-zinc-200 bg-white px-3 py-2 text-xs dark:border-zinc-800 dark:bg-zinc-950">
            <span className="font-semibold text-zinc-700 dark:text-zinc-200">
              환율
            </span>
            {fx ? (
              <>
                <span className="tabular-nums text-zinc-600 dark:text-zinc-300">
                  원/달러 ₩{fx.usdKrw.toLocaleString("ko-KR", {
                    maximumFractionDigits: 2,
                  })}
                </span>
                <span className="tabular-nums text-zinc-600 dark:text-zinc-300">
                  원/헤알 ₩{fx.krwBrl.toLocaleString("ko-KR", {
                    maximumFractionDigits: 2,
                  })}
                </span>
                <span className="tabular-nums text-zinc-600 dark:text-zinc-300">
                  달러/헤알 R${fx.usdBrl.toLocaleString("ko-KR", {
                    maximumFractionDigits: 4,
                  })}
                </span>
              </>
            ) : (
              <span className="text-zinc-400">
                {fxError ?? "불러오는 중…"}
              </span>
            )}
            <button
              type="button"
              onClick={loadFx}
              disabled={fxLoading}
              className="ml-auto rounded border border-zinc-300 px-2 py-0.5 text-[11px] font-medium text-zinc-600 hover:bg-zinc-50 disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-900"
            >
              {fxLoading ? "조회 중…" : "새로고침"}
            </button>
          </div>

          <CurrencyExchange
            usdKrw={fx?.usdKrw ?? null}
            value={exchange}
            onChange={setExchange}
          />

          <p className="text-xs text-zinc-500 dark:text-zinc-400">
            주문일 {orderDate} · 결제일 {settlementDate} (D+0 브라질 영업일)
          </p>

          <BondOrderTable
            rows={rows}
            asOfDate={asOfDate}
            loading={bondLoading}
            error={bondError}
            fxReady={!!fx}
            settlementDate={settlementDate}
            exchangeKrwTotal={exchangeKrwTotal}
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
            krwMismatch={krwMismatch}
            krwMismatchDetail={
              krwMismatch
                ? { rows: checkedKrwTotal, exchange: exchangeKrwTotal }
                : null
            }
          />

          <footer className="pb-8 text-[11px] text-zinc-400">
            환율은 Frankfurter(ECB) 중간환율이며 실제 체결 환율·스프레드와
            다릅니다. 시세는 레포에 커밋된 주간 스냅샷 기준입니다. 발송 전 반드시
            값을 확인하세요.
          </footer>
        </>
      )}

      {tab === "cashflow" && <CashFlowPanel />}

      {tab === "simulation" && <SimulationPanel bonds={bonds} fx={fx} />}

      {tab === "duration" && <DurationPanel bonds={bonds} fx={fx} />}
    </div>
  );
}
