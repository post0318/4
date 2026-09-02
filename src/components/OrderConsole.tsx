"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { FxRatePanel } from "@/components/FxRatePanel";
import { Tabs } from "@/components/ui/Tabs";
import { Button } from "@/components/ui/Button";
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
import { linkHidesTrading } from "@/lib/cashflow/bondLink";
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
import { truncDecimals } from "@/lib/format";
import type { BondItem, BondSearchResponse, FxRates } from "@/lib/types";

export function OrderConsole() {
  const [fx, setFx] = useState<FxRates | null>(null);
  const [fxLoading, setFxLoading] = useState(true);
  const [fxError, setFxError] = useState<string | null>(null);

  const [bonds, setBonds] = useState<BondItem[]>([]);
  const [asOfDate, setAsOfDate] = useState<string | null>(null);
  const [bondLoading, setBondLoading] = useState(true);
  const [bondError, setBondError] = useState<string | null>(null);

  // 고객 공유 링크(?view=client)면 트레이딩(주문) 탭을 숨긴다.
  const [hideTrading] = useState(
    () => typeof window !== "undefined" && linkHidesTrading(window.location.search)
  );
  const [tab, setTab] = useState<
    "market" | "trading" | "cashflow" | "simulation" | "duration"
  >(() => (hideTrading ? "cashflow" : "market"));

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
        // 폴백: 종목 원화투자금액 ÷ 환율. 사용자가 고시환율을 고쳤으면 그 값,
        // 아니면 자동 조회 원/달러 환율.
        const fbRate =
          derivedExchange.rateEdited && derivedExchange.rate > 0
            ? derivedExchange.rate
            : (fx?.usdKrw ?? 0);
        autoUsd =
          fbRate > 0 && krwInput !== "" && krwNum > 0
            ? Math.round((krwNum / fbRate) * 100) / 100
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

  // 종목별 합계 vs 환전금액 — 원화·달러 모두 일치해야 발송 가능
  const checkedKrwTotal = useMemo(
    () =>
      rows.reduce((s, r) => s + (r.checked ? Number(r.krwInput) || 0 : 0), 0),
    [rows]
  );
  const checkedUsdTotal = useMemo(
    () =>
      rows.reduce(
        (s, r) => s + (r.checked ? parseFloat(r.usdInput || "0") || 0 : 0),
        0
      ),
    [rows]
  );
  const exchangeKrwTotal = derivedExchange.krwTotal;
  const exchangeUsdTotal = derivedExchange.usdTotal;
  const anyChecked = useMemo(() => rows.some((r) => r.checked), [rows]);

  const krwMismatch =
    exchangeKrwTotal > 0 && anyChecked && checkedKrwTotal !== exchangeKrwTotal;
  // 종목별 달러($)를 직접 수정하면 합계가 환전 달러금액과 어긋날 수 있다
  const usdMismatch =
    exchangeUsdTotal > 0 &&
    anyChecked &&
    Math.abs(
      truncDecimals(checkedUsdTotal, 2) - truncDecimals(exchangeUsdTotal, 2)
    ) >= 0.005;
  // 환전금액을 아예 입력하지 않으면 원화·달러 대사를 건너뛴다 (경고만)
  const exchangeUnused =
    exchangeKrwTotal === 0 && anyChecked && checkedKrwTotal > 0;

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
  ].filter((t) => !(hideTrading && t.key === "trading"));

  return (
    <div className="print-page mx-auto grid max-w-6xl gap-5 p-4 sm:p-6">
      <header className="print:hidden">
        <h1 className="flex items-center gap-2 text-lg font-bold tracking-tight text-zinc-900 dark:text-zinc-100">
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

      <Tabs
        tabs={TABS}
        active={tab}
        onChange={setTab}
        className="print:hidden"
      />

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

      {tab === "trading" && !hideTrading && (
        <>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 rounded-xl border border-zinc-200/80 bg-white px-3.5 py-2.5 text-xs shadow-sm dark:border-zinc-800 dark:bg-zinc-950 dark:shadow-none">
            <span className="font-semibold tracking-tight text-zinc-700 dark:text-zinc-200">
              환율
            </span>
            {fx ? (
              <>
                <span className="tabular-nums text-zinc-600 dark:text-zinc-300">
                  원/달러{" "}
                  <span className="font-medium text-zinc-900 dark:text-zinc-100">
                    ₩{fx.usdKrw.toLocaleString("ko-KR", {
                      maximumFractionDigits: 2,
                    })}
                  </span>
                </span>
                <span className="tabular-nums text-zinc-600 dark:text-zinc-300">
                  원/헤알{" "}
                  <span className="font-medium text-zinc-900 dark:text-zinc-100">
                    ₩{fx.krwBrl.toLocaleString("ko-KR", {
                      maximumFractionDigits: 2,
                    })}
                  </span>
                </span>
                <span className="tabular-nums text-zinc-600 dark:text-zinc-300">
                  달러/헤알{" "}
                  <span className="font-medium text-zinc-900 dark:text-zinc-100">
                    R${fx.usdBrl.toLocaleString("ko-KR", {
                      maximumFractionDigits: 4,
                    })}
                  </span>
                </span>
              </>
            ) : (
              <span className="text-zinc-400">{fxError ?? "불러오는 중…"}</span>
            )}
            <Button
              size="sm"
              variant="secondary"
              onClick={loadFx}
              disabled={fxLoading}
              className="ml-auto"
            >
              {fxLoading ? "조회 중…" : "새로고침"}
            </Button>
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
            exchangeUsdTotal={exchangeUsdTotal}
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
            usdMismatch={usdMismatch}
            usdMismatchDetail={
              usdMismatch
                ? {
                    rows: truncDecimals(checkedUsdTotal, 2),
                    exchange: truncDecimals(exchangeUsdTotal, 2),
                  }
                : null
            }
            exchangeUnused={exchangeUnused}
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
