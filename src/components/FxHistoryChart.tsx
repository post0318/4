"use client";

import { useMemo, useState } from "react";
import { fmtNum } from "@/lib/format";

interface FxHistoryChartProps {
  label: string;
  /** ISO 날짜, 오름차순 */
  dates: string[];
  values: number[];
  /** 값 소수 자리 */
  digits: number;
  unit: string;
}

const W = 900;
const H = 130;
const PAD = { top: 6, right: 6, bottom: 16, left: 48 };

/**
 * 환율 7년치 일간 추이를 인라인 SVG 라인차트로 그린다. 외부 차트 라이브러리
 * 없이 반응형(viewBox) + 마우스 호버 판독만 지원한다.
 */
export function FxHistoryChart({
  label,
  dates,
  values,
  digits,
  unit,
}: FxHistoryChartProps) {
  const [hover, setHover] = useState<number | null>(null);

  const chart = useMemo(() => {
    const n = values.length;
    if (n === 0) return null;

    const min = Math.min(...values);
    const max = Math.max(...values);
    const span = max - min || 1;
    const yMin = min - span * 0.08;
    const yMax = max + span * 0.08;

    const plotW = W - PAD.left - PAD.right;
    const plotH = H - PAD.top - PAD.bottom;
    const x = (i: number) => PAD.left + (n === 1 ? plotW / 2 : (i / (n - 1)) * plotW);
    const y = (v: number) =>
      PAD.top + plotH - ((v - yMin) / (yMax - yMin)) * plotH;

    const line = values.map((v, i) => `${x(i)},${y(v)}`).join(" ");
    const area = `${PAD.left},${PAD.top + plotH} ${line} ${PAD.left + plotW},${
      PAD.top + plotH
    }`;

    // x축: 연도 경계 눈금
    const yearTicks: { i: number; label: string }[] = [];
    let lastYear = "";
    dates.forEach((d, i) => {
      const yr = d.slice(0, 4);
      if (yr !== lastYear) {
        yearTicks.push({ i, label: yr });
        lastYear = yr;
      }
    });

    return { n, yMin, yMax, x, y, line, area, plotW, plotH, yearTicks };
  }, [values, dates]);

  if (!chart) return null;

  const { x, y, line, area, plotH, yearTicks } = chart;
  const first = values[0];
  const last = values[values.length - 1];
  const change = last - first;
  const changePct = (change / first) * 100;

  const hv = hover != null ? values[hover] : null;
  const hd = hover != null ? dates[hover] : null;

  return (
    <div className="mt-2 rounded-lg border border-zinc-200 bg-zinc-50 p-2 dark:border-zinc-800 dark:bg-zinc-900">
      <div className="mb-0.5 flex items-baseline justify-between">
        <p className="text-[11px] font-semibold text-zinc-700 dark:text-zinc-200">
          {label} · 7년 일간 추이
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
        onMouseLeave={() => setHover(null)}
        onMouseMove={(e) => {
          const rect = e.currentTarget.getBoundingClientRect();
          const px = ((e.clientX - rect.left) / rect.width) * W;
          const ratio = (px - PAD.left) / (W - PAD.left - PAD.right);
          const idx = Math.round(ratio * (chart.n - 1));
          setHover(Math.min(chart.n - 1, Math.max(0, idx)));
        }}
      >
        <defs>
          <linearGradient id="fxArea" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="currentColor" stopOpacity="0.18" />
            <stop offset="100%" stopColor="currentColor" stopOpacity="0" />
          </linearGradient>
        </defs>

        {/* y축 그리드 + 라벨 (3등분) */}
        {[0, 0.5, 1].map((t) => {
          const v = chart.yMax - t * (chart.yMax - chart.yMin);
          const gy = PAD.top + t * plotH;
          return (
            <g key={t}>
              <line
                x1={PAD.left}
                y1={gy}
                x2={W - PAD.right}
                y2={gy}
                className="stroke-zinc-200 dark:stroke-zinc-800"
                strokeWidth={1}
              />
              <text
                x={PAD.left - 6}
                y={gy + 3}
                textAnchor="end"
                className="fill-zinc-400 text-[10px] tabular-nums"
              >
                {fmtNum(v, digits)}
              </text>
            </g>
          );
        })}

        {/* x축 연도 라벨 */}
        {yearTicks.map((t) => (
          <text
            key={t.label}
            x={x(t.i)}
            y={H - 6}
            textAnchor="middle"
            className="fill-zinc-400 text-[10px] tabular-nums"
          >
            {t.label}
          </text>
        ))}

        <polygon points={area} fill="url(#fxArea)" className="text-blue-500" />
        <polyline
          points={line}
          fill="none"
          className="stroke-blue-500"
          strokeWidth={1.5}
          strokeLinejoin="round"
        />

        {hover != null && hv != null && (
          <g>
            <line
              x1={x(hover)}
              y1={PAD.top}
              x2={x(hover)}
              y2={PAD.top + plotH}
              className="stroke-zinc-400"
              strokeWidth={1}
              strokeDasharray="3 3"
            />
            <circle
              cx={x(hover)}
              cy={y(hv)}
              r={3}
              className="fill-blue-500"
            />
          </g>
        )}
      </svg>

      <p className="mt-1 text-center text-[11px] tabular-nums text-zinc-500 dark:text-zinc-400">
        {hd && hv != null ? (
          <>
            {hd} · {unit} {fmtNum(hv, digits)}
          </>
        ) : (
          <>
            {dates[0]} ~ {dates[dates.length - 1]} · 최근 {unit}{" "}
            {fmtNum(last, digits)}
          </>
        )}
      </p>
    </div>
  );
}
