"use client";

import { useEffect, useState } from "react";
import { FxHistoryChart, type ChartSeries } from "@/components/FxHistoryChart";
import { fmtNum, fmtTimestamp } from "@/lib/format";
import type { FxRates } from "@/lib/types";

interface FxRatePanelProps {
  rates: FxRates | null;
  loading: boolean;
  error: string | null;
  onRefresh: () => void;
}

type CardKey = "krwBrl" | "usdBrl" | "rates";

interface FxHistory {
  dates: string[];
  usdKrw: number[];
  usdBrl: number[];
  krwBrl: number[];
}

/**
 * 브라질 시장정보 — 원/헤알·달러/헤알 환율과 브라질 기준금리(Selic).
 * 원/헤알은 파생값, 원/달러는 카드로 노출하지 않지만 수량 계산용으로 별도 조회한다.
 * 카드를 누르면 아래에 해당 지표의 7년 추이 차트가 열린다(시작 시 원/헤알).
 */
export function FxRatePanel({ rates, loading, error, onRefresh }: FxRatePanelProps) {
  const [selected, setSelected] = useState<CardKey>("krwBrl");
  const [hist, setHist] = useState<FxHistory | null>(null);
  const [selic, setSelic] = useState<ChartSeries | null>(null);
  const [ntnf, setNtnf] = useState<ChartSeries | null>(null);
  const [chartLoading, setChartLoading] = useState(true);
  const [chartError, setChartError] = useState<string | null>(null);
  const [staleWarning, setStaleWarning] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    Promise.allSettled([
      fetch("/api/fx-history").then((r) => r.json()),
      fetch("/api/br-selic").then((r) => r.json()),
      fetch("/api/ntnf-yield").then((r) => r.json()),
    ])
      .then(([fxRes, selicRes, ntnfRes]) => {
        if (cancelled) return;
        if (fxRes.status === "fulfilled" && Array.isArray(fxRes.value?.dates)) {
          setHist(fxRes.value as FxHistory);
        } else {
          setChartError("추이를 불러오지 못했습니다.");
        }
        if (
          selicRes.status === "fulfilled" &&
          Array.isArray(selicRes.value?.dates)
        ) {
          setSelic(selicRes.value as ChartSeries);
        }
        if (
          ntnfRes.status === "fulfilled" &&
          Array.isArray(ntnfRes.value?.dates)
        ) {
          const s = ntnfRes.value as ChartSeries;
          setNtnf(s);
          const last = new Date(s.dates[s.dates.length - 1]).getTime();
          if (Date.now() - last > 12 * 86_400_000) {
            setStaleWarning(
              "국채금리 데이터가 12일 이상 갱신되지 않았습니다(주간 스냅샷 확인)."
            );
          }
        }
      })
      .finally(() => {
        if (!cancelled) setChartLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const selicNow = selic ? selic.values[selic.values.length - 1] : null;

  const cards: {
    key: CardKey;
    label: string;
    value: string;
    hint: string;
  }[] = [
    {
      key: "krwBrl",
      label: "원/헤알",
      value: rates ? `₩ ${fmtNum(rates.krwBrl, 2)}` : "-",
      hint: "1 BRL",
    },
    {
      key: "usdBrl",
      label: "달러/헤알",
      value: rates ? `R$ ${fmtNum(rates.usdBrl, 4)}` : "-",
      hint: "1 USD",
    },
    {
      key: "rates",
      label: "브라질 기준금리",
      value: selicNow != null ? `${fmtNum(selicNow, 2)}%` : "-",
      hint: "Selic meta · 차트에 국채금리 함께",
    },
  ];

  let chartProps: {
    label: string;
    unit: string;
    suffix?: string;
    digits: number;
    stepped?: boolean;
    series: ChartSeries;
    overlay?: { series: ChartSeries; label: string; stepped?: boolean };
  } | null = null;
  if (selected === "rates" && ntnf) {
    chartProps = {
      label: "국채금리(~10년)",
      unit: "",
      suffix: "%",
      digits: 2,
      series: ntnf,
      overlay: selic
        ? { series: selic, label: "기준금리", stepped: true }
        : undefined,
    };
  } else if ((selected === "krwBrl" || selected === "usdBrl") && hist) {
    chartProps = {
      label: selected === "krwBrl" ? "원/헤알" : "달러/헤알",
      unit: selected === "krwBrl" ? "₩" : "R$",
      digits: selected === "krwBrl" ? 2 : 4,
      series: {
        dates: hist.dates,
        values: selected === "krwBrl" ? hist.krwBrl : hist.usdBrl,
      },
    };
  }

  return (
    <section className="rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-950">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
          브라질 시장정보
        </h2>
        <button
          type="button"
          onClick={onRefresh}
          disabled={loading}
          className="rounded-md border border-zinc-300 px-2.5 py-1 text-xs font-medium text-zinc-600 hover:bg-zinc-50 disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-900"
        >
          {loading ? "조회 중…" : "새로고침"}
        </button>
      </div>

      <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
        {cards.map((c) => {
          const active = selected === c.key;
          return (
            <button
              key={c.key}
              type="button"
              onClick={() => setSelected(c.key)}
              aria-pressed={active}
              className={`rounded-lg p-3 text-left transition-colors ${
                active
                  ? "bg-blue-50 ring-1 ring-blue-400 dark:bg-blue-950/40"
                  : "bg-zinc-50 hover:bg-zinc-100 dark:bg-zinc-900 dark:hover:bg-zinc-800"
              }`}
            >
              <p className="text-xs text-zinc-500 dark:text-zinc-400">{c.label}</p>
              <p className="mt-1 text-lg font-semibold tabular-nums text-zinc-900 dark:text-zinc-100">
                {c.value}
              </p>
              <p className="text-[11px] text-zinc-400">{c.hint}</p>
            </button>
          );
        })}
      </div>

      {chartLoading && (
        <p className="mt-2 text-[11px] text-zinc-500 dark:text-zinc-400">
          추이 불러오는 중…
        </p>
      )}
      {chartError && !hist && (
        <p className="mt-2 text-[11px] text-red-500">{chartError}</p>
      )}
      {chartProps && <FxHistoryChart {...chartProps} />}

      {staleWarning && (
        <p className="mt-2 text-[11px] text-amber-600 dark:text-amber-400">
          ⚠ {staleWarning}
        </p>
      )}

      <p className="mt-2 text-[11px] text-zinc-400">
        {error
          ? error
          : rates
            ? `환율 ${fmtTimestamp(
                rates.asOf
              )} Frankfurter(ECB) · 기준금리 브라질 중앙은행 · 국채금리 재무부(주간)`
            : "환율을 불러오는 중입니다."}
      </p>
    </section>
  );
}
