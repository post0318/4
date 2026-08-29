"use client";

import { useMemo, useState } from "react";
import { fmtNum } from "@/lib/format";

export interface ChartSeries {
  /** ISO 날짜, 오름차순 */
  dates: string[];
  values: number[];
}

interface FxHistoryChartProps {
  label: string;
  /** 값 앞 단위 ("₩", "R$", "") */
  unit: string;
  /** 값 뒤 접미 ("%" 등) */
  suffix?: string;
  digits: number;
  /** 계단식으로 그릴지 (기준금리처럼 회의 때만 바뀌는 값) */
  stepped?: boolean;
  series: ChartSeries;
}

const W = 900;
const H = 140;
const PAD = { top: 8, right: 10, bottom: 16, left: 52 };

const t = (iso: string) => new Date(iso).getTime();

/** 계단식 시계열에서 특정 시각의 유효값 */
function valueAt(series: ChartSeries, time: number): number | null {
  let v: number | null = null;
  for (let i = 0; i < series.dates.length; i++) {
    if (t(series.dates[i]) <= time) v = series.values[i];
    else break;
  }
  return v ?? series.values[0] ?? null;
}

export function FxHistoryChart({
  label,
  unit,
  suffix = "",
  digits,
  stepped = false,
  series,
}: FxHistoryChartProps) {
  const [hoverT, setHoverT] = useState<number | null>(null);

  const chart = useMemo(() => {
    const n = series.dates.length;
    if (n === 0) return null;

    const t0 = t(series.dates[0]);
    const t1 = t(series.dates[n - 1]);
    const plotW = W - PAD.left - PAD.right;
    const plotH = H - PAD.top - PAD.bottom;
    const px = (time: number) =>
      PAD.left + ((time - t0) / (t1 - t0 || 1)) * plotW;

    const min = Math.min(...series.values);
    const max = Math.max(...series.values);
    const span = max - min || 1;
    const yMin = min - span * 0.1;
    const yMax = max + span * 0.1;
    const y = (v: number) =>
      PAD.top + plotH - ((v - yMin) / (yMax - yMin)) * plotH;

    let path = "";
    series.dates.forEach((d, i) => {
      const x = px(t(d));
      const yy = y(series.values[i]);
      if (i === 0) path = `M ${x} ${yy}`;
      else if (stepped) path += ` H ${x} V ${yy}`;
      else path += ` L ${x} ${yy}`;
    });
    const area = `${path} L ${px(t1)} ${PAD.top + plotH} L ${
      PAD.left
    } ${PAD.top + plotH} Z`;

    const years: { x: number; label: string }[] = [];
    for (
      let yr = new Date(t0).getFullYear();
      yr <= new Date(t1).getFullYear();
      yr++
    ) {
      const time = new Date(`${yr}-01-01`).getTime();
      if (time >= t0 && time <= t1) years.push({ x: px(time), label: `${yr}` });
    }

    return { t0, t1, plotH, px, y, yMin, yMax, path, area, years };
  }, [series, stepped]);

  if (!chart) return null;

  const { t0, t1, plotH, px, y, yMin, yMax, path, area, years } = chart;
  const first = series.values[0];
  const last = series.values[series.values.length - 1];
  const change = last - first;
  const changePct = (change / first) * 100;

  const hv = hoverT != null ? valueAt(series, hoverT) : null;
  const hDate =
    hoverT != null ? new Date(hoverT).toISOString().slice(0, 10) : null;

  const fmtVal = (v: number) =>
    `${unit ? unit + " " : ""}${fmtNum(v, digits)}${suffix}`;

  return (
    <div className="mt-2 rounded-lg border border-zinc-200 bg-zinc-50 p-2 dark:border-zinc-800 dark:bg-zinc-900">
      <div className="mb-0.5 flex flex-wrap items-baseline justify-between gap-x-3">
        <p className="text-[11px] font-semibold text-zinc-700 dark:text-zinc-200">
          {label} · 7년 추이
        </p>
        <p className="text-[10px] tabular-nums text-zinc-500 dark:text-zinc-400">
          <span
            className={
              change >= 0
                ? "text-emerald-600 dark:text-emerald-400"
                : "text-red-600 dark:text-red-400"
            }
          >
            {change >= 0 ? "+" : ""}
            {fmtNum(change, digits)} ({changePct >= 0 ? "+" : ""}
            {fmtNum(changePct, 1)}%)
          </span>
        </p>
      </div>

      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="w-full"
        role="img"
        aria-label={`${label} 7년 추이 차트`}
        onMouseLeave={() => setHoverT(null)}
        onMouseMove={(e) => {
          const rect = e.currentTarget.getBoundingClientRect();
          const cx = ((e.clientX - rect.left) / rect.width) * W;
          const ratio = (cx - PAD.left) / (W - PAD.left - PAD.right);
          setHoverT(t0 + Math.min(1, Math.max(0, ratio)) * (t1 - t0));
        }}
      >
        <defs>
          <linearGradient id="fxArea" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="currentColor" stopOpacity="0.16" />
            <stop offset="100%" stopColor="currentColor" stopOpacity="0" />
          </linearGradient>
        </defs>

        {[0, 0.5, 1].map((f) => {
          const v = yMax - f * (yMax - yMin);
          const gy = PAD.top + f * plotH;
          return (
            <g key={f}>
              <line
                x1={PAD.left}
                y1={gy}
                x2={W - PAD.right}
                y2={gy}
                className="stroke-zinc-200 dark:stroke-zinc-800"
                strokeWidth={1}
              />
              <text
                x={PAD.left - 5}
                y={gy + 3}
                textAnchor="end"
                className="fill-zinc-400 text-[9px] tabular-nums"
              >
                {fmtNum(v, digits)}
              </text>
            </g>
          );
        })}

        {years.map((yr) => (
          <text
            key={yr.label}
            x={yr.x}
            y={H - 5}
            textAnchor="middle"
            className="fill-zinc-400 text-[9px] tabular-nums"
          >
            {yr.label}
          </text>
        ))}

        <path d={area} fill="url(#fxArea)" className="text-blue-500" />
        <path
          d={path}
          fill="none"
          className="stroke-blue-500"
          strokeWidth={1.5}
          strokeLinejoin="round"
        />

        {hoverT != null && hv != null && (
          <g>
            <line
              x1={px(hoverT)}
              y1={PAD.top}
              x2={px(hoverT)}
              y2={PAD.top + plotH}
              className="stroke-zinc-400"
              strokeWidth={1}
              strokeDasharray="3 3"
            />
            <circle cx={px(hoverT)} cy={y(hv)} r={3} className="fill-blue-500" />
          </g>
        )}
      </svg>

      <p className="mt-0.5 text-center text-[11px] tabular-nums text-zinc-500 dark:text-zinc-400">
        {hDate && hv != null ? (
          <>
            {hDate} · {fmtVal(hv)}
          </>
        ) : (
          <>
            {series.dates[0]} ~ {series.dates[series.dates.length - 1]}
          </>
        )}
      </p>
    </div>
  );
}
