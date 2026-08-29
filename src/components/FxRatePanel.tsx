"use client";

import { useCallback, useEffect, useState } from "react";
import {
  FxHistoryChart,
  type ChartSeries,
} from "@/components/FxHistoryChart";
import { fmtNum, fmtTimestamp } from "@/lib/format";
import type { FxRates } from "@/lib/types";

interface FxRatePanelProps {
  rates: FxRates | null;
  loading: boolean;
  error: string | null;
  onRefresh: () => void;
}

type PairKey = "krwBrl" | "usdBrl" | "usdKrw";

interface FxHistory {
  dates: string[];
  usdKrw: number[];
  usdBrl: number[];
  krwBrl: number[];
}

const CARDS: {
  key: PairKey;
  label: string;
  unit: string;
  digits: number;
  hint: string;
}[] = [
  { key: "krwBrl", label: "원/헤알", unit: "₩", digits: 2, hint: "1 BRL · 파생" },
  { key: "usdBrl", label: "달러/헤알", unit: "R$", digits: 4, hint: "1 USD" },
  { key: "usdKrw", label: "원/달러", unit: "₩", digits: 2, hint: "1 USD" },
];

/**
 * 브라질 시장정보 — 원/헤알·달러/헤알·원/달러 환율. 원/헤알은 파생값이다.
 * 카드를 누르면 아래에 그 통화쌍의 7년 일간 추이 + 브라질 기준금리(오른쪽 축)
 * 차트가 열린다. 시작 시 원/헤알을 기본으로 보여준다.
 */
export function FxRatePanel({ rates, loading, error, onRefresh }: FxRatePanelProps) {
  const [selected, setSelected] = useState<PairKey>("krwBrl");
  const [hist, setHist] = useState<FxHistory | null>(null);
  const [selic, setSelic] = useState<ChartSeries | null>(null);
  const [histLoading, setHistLoading] = useState(true);
  const [histError, setHistError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    Promise.allSettled([
      fetch("/api/fx-history").then((r) => r.json()),
      fetch("/api/br-selic").then((r) => r.json()),
    ])
      .then(([fxRes, selicRes]) => {
        if (cancelled) return;
        if (
          fxRes.status === "fulfilled" &&
          Array.isArray(fxRes.value?.dates)
        ) {
          const d = fxRes.value as FxHistory;
          setHist({
            dates: d.dates,
            usdKrw: d.usdKrw,
            usdBrl: d.usdBrl,
            krwBrl: d.krwBrl,
          });
        } else {
          setHistError("추이를 불러오지 못했습니다.");
        }
        if (
          selicRes.status === "fulfilled" &&
          Array.isArray(selicRes.value?.dates)
        ) {
          setSelic(selicRes.value as ChartSeries);
        }
      })
      .finally(() => {
        if (!cancelled) setHistLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const pick = useCallback((key: PairKey) => setSelected(key), []);

  const activeCard = CARDS.find((c) => c.key === selected)!;

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
        {CARDS.map((c) => {
          const active = selected === c.key;
          return (
            <button
              key={c.key}
              type="button"
              onClick={() => pick(c.key)}
              aria-pressed={active}
              className={`rounded-lg p-3 text-left transition-colors ${
                active
                  ? "bg-blue-50 ring-1 ring-blue-400 dark:bg-blue-950/40"
                  : "bg-zinc-50 hover:bg-zinc-100 dark:bg-zinc-900 dark:hover:bg-zinc-800"
              }`}
            >
              <p className="text-xs text-zinc-500 dark:text-zinc-400">{c.label}</p>
              <p className="mt-1 text-lg font-semibold tabular-nums text-zinc-900 dark:text-zinc-100">
                {rates ? `${c.unit} ${fmtNum(rates[c.key], c.digits)}` : "-"}
              </p>
              <p className="text-[11px] text-zinc-400">{c.hint}</p>
            </button>
          );
        })}
      </div>

      {histLoading && (
        <p className="mt-2 text-[11px] text-zinc-500 dark:text-zinc-400">
          추이 불러오는 중…
        </p>
      )}
      {histError && !hist && (
        <p className="mt-2 text-[11px] text-red-500">{histError}</p>
      )}
      {hist && (
        <FxHistoryChart
          label={activeCard.label}
          unit={activeCard.unit}
          digits={activeCard.digits}
          fx={{ dates: hist.dates, values: hist[activeCard.key] }}
          selic={selic}
        />
      )}

      <p className="mt-2 text-[11px] text-zinc-400">
        {error
          ? error
          : rates
            ? `환율 기준시각 ${fmtTimestamp(
                rates.asOf
              )} · 출처 Frankfurter(ECB) · 기준금리 브라질 중앙은행`
            : "환율을 불러오는 중입니다."}
      </p>
    </section>
  );
}
