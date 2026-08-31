"use client";

import { useEffect, useState } from "react";
import { FxHistoryChart, type ChartSeries } from "@/components/FxHistoryChart";
import { Card, CardHeader } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { cn, hint } from "@/lib/ui";
import { fmtNum, fmtTimestamp } from "@/lib/format";
import type { FxRates } from "@/lib/types";

interface FxRatePanelProps {
  rates: FxRates | null;
  loading: boolean;
  error: string | null;
  onRefresh: () => void;
}

type CardKey = "krwBrl" | "usdKrw" | "usdBrl" | "rates";

interface FxHistory {
  dates: string[];
  usdKrw: number[];
  usdBrl: number[];
  krwBrl: number[];
}

/**
 * 브라질 시장정보 — 원/헤알·원/달러·달러/헤알 환율과 브라질 기준금리(Selic).
 * 원/헤알은 usdKrw/usdBrl 파생값(표시·수량계산 일치용).
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
      key: "usdKrw",
      label: "원/달러",
      value: rates ? `₩ ${fmtNum(rates.usdKrw, 2)}` : "-",
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
    strength?: { name: string; invert?: boolean };
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
  } else if (
    (selected === "krwBrl" || selected === "usdKrw" || selected === "usdBrl") &&
    hist
  ) {
    const meta = {
      krwBrl: {
        label: "원/헤알",
        unit: "₩",
        digits: 2,
        values: hist.krwBrl,
        strength: { name: "헤알" },
      },
      usdKrw: {
        label: "원/달러",
        unit: "₩",
        digits: 2,
        values: hist.usdKrw,
        strength: { name: "달러" },
      },
      usdBrl: {
        label: "달러/헤알",
        unit: "R$",
        digits: 4,
        values: hist.usdBrl,
        strength: { name: "헤알", invert: true },
      },
    }[selected];
    chartProps = {
      label: meta.label,
      unit: meta.unit,
      digits: meta.digits,
      series: { dates: hist.dates, values: meta.values },
      strength: meta.strength,
    };
  }

  return (
    <Card>
      <CardHeader
        title="브라질 시장정보"
        action={
          <Button size="sm" onClick={onRefresh} disabled={loading}>
            {loading ? "조회 중…" : "새로고침"}
          </Button>
        }
      />

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {cards.map((c) => {
          const active = selected === c.key;
          return (
            <button
              key={c.key}
              type="button"
              onClick={() => setSelected(c.key)}
              aria-pressed={active}
              className={cn(
                "rounded-lg border p-3 text-left transition-colors outline-none focus-visible:ring-2 focus-visible:ring-blue-500/25",
                active
                  ? "border-blue-300 bg-blue-50/70 dark:border-blue-800 dark:bg-blue-950/40"
                  : "border-transparent bg-zinc-50 hover:bg-zinc-100 dark:bg-zinc-900 dark:hover:bg-zinc-800"
              )}
            >
              <p className="text-xs font-medium text-zinc-500 dark:text-zinc-400">
                {c.label}
              </p>
              <p className="mt-1 text-lg font-semibold tracking-tight tabular-nums text-zinc-900 dark:text-zinc-100">
                {c.value}
              </p>
              <p className="mt-0.5 text-[11px] text-zinc-400">{c.hint}</p>
            </button>
          );
        })}
      </div>

      {chartLoading && (
        <p className={cn(hint, "mt-2")}>추이 불러오는 중…</p>
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

      <p className={cn(hint, "mt-3")}>
        {error
          ? error
          : rates
            ? `환율 ${fmtTimestamp(
                rates.asOf
              )} Frankfurter(ECB) · 기준금리 브라질 중앙은행 · 국채금리 재무부(주간)`
            : "환율을 불러오는 중입니다."}
      </p>
    </Card>
  );
}
