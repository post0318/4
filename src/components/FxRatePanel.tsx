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
  const [chartNote, setChartNote] = useState<string | null>(null);

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
          const meta = ntnfRes.value as { liveDates?: string[]; anbimaDates?: string[]; csvAsOfDate?: string; lastMove?: number | null };
          const last = new Date(s.dates[s.dates.length - 1]).getTime();
          const notes: string[] = [];
          if (Date.now() - last > 5 * 86_400_000) {
            notes.push("10년국채수익률 데이터가 5일 넘게 갱신되지 않았습니다(일일 갱신 확인).");
          }
          setChartNote(
            meta.anbimaDates && meta.anbimaDates.length > 0
              ? `차트 기준: ${meta.anbimaDates[0]} 이후는 ANBIMA 기관 간 지표금리(종가), 그 이전은 재무부 매수·매도 호가의 중간값입니다.`
              : "차트 기준: 재무부 매수·매도 호가의 중간값입니다."
          );
          if (meta.liveDates && meta.liveDates.length > 0) {
            notes.push(
              `최근 ${meta.liveDates.length}일(${meta.liveDates[0]}~${meta.liveDates[meta.liveDates.length - 1]})은 재무부 실시간 호가의 중간값(임시)입니다. 기관 지표나 재무부 확정 자료가 올라오면 자동 교체됩니다.`
            );
          }
          if (typeof meta.lastMove === "number" && Math.abs(meta.lastMove) >= 0.5) {
            notes.push(`마지막 하루 변동 ${meta.lastMove > 0 ? "+" : ""}${meta.lastMove}%p — 큰 변동입니다. 시장 움직임인지 확인하세요.`);
          }
          if (notes.length) setStaleWarning(notes.join(" "));
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

  // 카드는 이름·값 두 줄만 — "1 BRL"·"Selic meta" 같은 셋째 줄은 없앤다
  // (오너 지시 2026-09-22)
  const cards: {
    key: CardKey;
    label: string;
    value: string;
  }[] = [
    {
      key: "krwBrl",
      label: "원/헤알",
      value: rates ? `₩ ${fmtNum(rates.krwBrl, 2)}` : "-",
    },
    {
      key: "usdBrl",
      label: "달러/헤알",
      value: rates ? `R$ ${fmtNum(rates.usdBrl, 4)}` : "-",
    },
    {
      key: "usdKrw",
      label: "원/달러",
      value: rates ? `₩ ${fmtNum(rates.usdKrw, 2)}` : "-",
    },
    {
      key: "rates",
      label: "브라질 기준금리",
      value: selicNow != null ? `${fmtNum(selicNow, 2)}%` : "-",
    },
  ];

  let chartProps: {
    label: string;
    unit: string;
    suffix?: string;
    digits: number;
    stepped?: boolean;
    series: ChartSeries;
    yAxis?: { min: number; max: number };
    overlay?: { series: ChartSeries; label: string; stepped?: boolean };
    strength?: { name: string; invert?: boolean };
  } | null = null;
  if (selected === "rates" && ntnf) {
    chartProps = {
      label: "10년국채수익률",
      unit: "",
      suffix: "%",
      digits: 2,
      series: ntnf,
      // 두 선을 같은 눈금으로 본다. 0~17% 를 기준으로 두고 값이 넘으면 그만큼만
      // 넓힌다(오너 지시 2026-09-22 — 넓게 잡으면 평탄해 보인다)
      yAxis: { min: 0, max: 17 },
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

      {chartNote && (
        <p className="mt-2 text-[11px] text-zinc-500 dark:text-zinc-400">{chartNote}</p>
      )}

      {staleWarning && (
        <p className="mt-2 text-[11px] text-amber-600 dark:text-amber-400">
          ⚠ {staleWarning}
        </p>
      )}

      <p className={cn(hint, "mt-3")}>
        {error
          ? error
          : rates
            ? `환율 ${
                rates.rateDate ? `ECB 고시일 ${rates.rateDate} · ` : ""
              }조회 ${fmtTimestamp(
                rates.asOf
              )} Frankfurter(ECB) · 기준금리 브라질 중앙은행 · 10년국채수익률 ANBIMA 기관 지표·재무부(일일)`
            : "환율을 불러오는 중입니다."}
      </p>
    </Card>
  );
}
