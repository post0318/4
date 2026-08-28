"use client";

import { fmtNum, fmtTimestamp } from "@/lib/format";
import type { FxRates } from "@/lib/types";

interface FxRatePanelProps {
  rates: FxRates | null;
  loading: boolean;
  error: string | null;
  onRefresh: () => void;
}

/**
 * 원/달러·달러/헤알·원/헤알 환율 자동 표시 (요구사항 1).
 * 원/헤알은 usdKrw/usdBrl 파생값이다.
 */
export function FxRatePanel({ rates, loading, error, onRefresh }: FxRatePanelProps) {
  const cards: { label: string; value: string; hint: string }[] = [
    {
      label: "원/달러",
      value: rates ? `₩ ${fmtNum(rates.usdKrw, 2)}` : "-",
      hint: "1 USD",
    },
    {
      label: "달러/헤알",
      value: rates ? `R$ ${fmtNum(rates.usdBrl, 4)}` : "-",
      hint: "1 USD",
    },
    {
      label: "원/헤알",
      value: rates ? `₩ ${fmtNum(rates.krwBrl, 2)}` : "-",
      hint: "1 BRL · 파생",
    },
  ];

  return (
    <section className="rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-950">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
          환율 <span className="text-zinc-400">(중간환율)</span>
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
        {cards.map((c) => (
          <div
            key={c.label}
            className="rounded-lg bg-zinc-50 p-3 dark:bg-zinc-900"
          >
            <p className="text-xs text-zinc-500 dark:text-zinc-400">{c.label}</p>
            <p className="mt-1 text-lg font-semibold tabular-nums text-zinc-900 dark:text-zinc-100">
              {c.value}
            </p>
            <p className="text-[11px] text-zinc-400">{c.hint}</p>
          </div>
        ))}
      </div>

      <p className="mt-2 text-[11px] text-zinc-400">
        {error
          ? error
          : rates
            ? `기준시각 ${fmtTimestamp(rates.asOf)} · 출처 Frankfurter(ECB)`
            : "환율을 불러오는 중입니다."}
      </p>
    </section>
  );
}
