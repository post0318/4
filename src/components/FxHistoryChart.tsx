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
  unit: string;
  /** 환율 값 소수 자리 */
  digits: number;
  /** 왼쪽 축 — 환율(기준값) */
  fx: ChartSeries;
  /** 오른쪽 축 — 브라질 기준금리(%), 없으면 생략 */
  selic: ChartSeries | null;
}

const W = 900;
const H = 140;
const PAD = { top: 8, right: 46, bottom: 16, left: 50 };

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

function domain(values: number[], pad = 0.08): [number, number] {
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  return [min - span * pad, max + span * pad];
}

/**
 * 환율 7년치 일간 추이(왼쪽 축)와 브라질 기준금리(오른쪽 축, %)를 한 차트에
 * 겹쳐 그린다. 외부 차트 라이브러리 없이 반응형(viewBox) + 호버 판독만 지원한다.
 * x축은 날짜(시간) 기준이라 두 시계열의 날짜가 달라도 정렬된다.
 */
export function FxHistoryChart({
  label,
  unit,
  digits,
  fx,
  selic,
}: FxHistoryChartProps) {
  const [hoverT, setHoverT] = useState<number | null>(null);

  const chart = useMemo(() => {
    if (fx.dates.length === 0) return null;
    const t0 = t(fx.dates[0]);
    const t1 = t(fx.dates[fx.dates.length - 1]);
    const plotW = W - PAD.left - PAD.right;
    const plotH = H - PAD.top - PAD.bottom;

    const px = (time: number) =>
      PAD.left + ((time - t0) / (t1 - t0 || 1)) * plotW;

    const [fxMin, fxMax] = domain(fx.values);
    const fxY = (v: number) =>
      PAD.top + plotH - ((v - fxMin) / (fxMax - fxMin)) * plotH;

    const fxLine = fx.dates
      .map((d, i) => `${px(t(d))},${fxY(fx.values[i])}`)
      .join(" ");
    const fxArea = `${PAD.left},${PAD.top + plotH} ${fxLine} ${
      PAD.left + plotW
    },${PAD.top + plotH}`;

    // 오른쪽 축: 기준금리 (구간 내 값 + 경계 클램프)
    let selicPlot: {
      line: string;
      rMin: number;
      rMax: number;
      rY: (v: number) => number;
    } | null = null;
    if (selic && selic.dates.length > 0) {
      const inWindow = selic.dates
        .map((d, i) => ({ time: t(d), v: selic.values[i] }))
        .filter((p) => p.time >= t0 && p.time <= t1);
      const startV = valueAt(selic, t0);
      const endV = valueAt(selic, t1);
      const pts = [
        ...(startV != null ? [{ time: t0, v: startV }] : []),
        ...inWindow,
        ...(endV != null ? [{ time: t1, v: endV }] : []),
      ];
      const vals = pts.map((p) => p.v);
      const [rMin, rMax] = domain(vals, 0.12);
      const rY = (v: number) =>
        PAD.top + plotH - ((v - rMin) / (rMax - rMin)) * plotH;
      // 계단식 path
      let dpath = "";
      pts.forEach((p, i) => {
        const x = px(p.time);
        const y = rY(p.v);
        if (i === 0) dpath = `M ${x} ${y}`;
        else dpath += ` H ${x} V ${y}`;
      });
      selicPlot = { line: dpath, rMin, rMax, rY };
    }

    // 연도 눈금
    const years: { x: number; label: string }[] = [];
    const y0 = new Date(t0).getFullYear();
    const y1 = new Date(t1).getFullYear();
    for (let y = y0; y <= y1; y++) {
      const time = new Date(`${y}-01-01`).getTime();
      if (time >= t0 && time <= t1) years.push({ x: px(time), label: `${y}` });
    }

    return {
      t0,
      t1,
      plotW,
      plotH,
      px,
      fxY,
      fxMin,
      fxMax,
      fxLine,
      fxArea,
      selicPlot,
      years,
    };
  }, [fx, selic]);

  if (!chart) return null;

  const { t0, t1, plotH, px, fxY, fxMin, fxMax, fxLine, fxArea, selicPlot, years } =
    chart;

  const fxFirst = fx.values[0];
  const fxLast = fx.values[fx.values.length - 1];
  const change = fxLast - fxFirst;
  const changePct = (change / fxFirst) * 100;

  const hFxV = hoverT != null ? valueAt(fx, hoverT) : null;
  const hSelicV = hoverT != null && selic ? valueAt(selic, hoverT) : null;
  const hDate =
    hoverT != null ? new Date(hoverT).toISOString().slice(0, 10) : null;

  return (
    <div className="mt-2 rounded-lg border border-zinc-200 bg-zinc-50 p-2 dark:border-zinc-800 dark:bg-zinc-900">
      <div className="mb-0.5 flex flex-wrap items-baseline justify-between gap-x-3">
        <p className="text-[11px] font-semibold text-zinc-700 dark:text-zinc-200">
          <span className="text-blue-600 dark:text-blue-400">■</span> {label}
          {selic && (
            <>
              {"  "}
              <span className="text-amber-600 dark:text-amber-400">■</span> 브라질
              기준금리(%)
            </>
          )}
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
          const time = t0 + Math.min(1, Math.max(0, ratio)) * (t1 - t0);
          setHoverT(time);
        }}
      >
        <defs>
          <linearGradient id="fxArea" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="currentColor" stopOpacity="0.16" />
            <stop offset="100%" stopColor="currentColor" stopOpacity="0" />
          </linearGradient>
        </defs>

        {/* 왼쪽 축 그리드 + 라벨 (환율) */}
        {[0, 0.5, 1].map((f) => {
          const v = fxMax - f * (fxMax - fxMin);
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
                className="fill-blue-500 text-[9px] tabular-nums"
              >
                {fmtNum(v, digits)}
              </text>
              {selicPlot && (
                <text
                  x={W - PAD.right + 4}
                  y={gy + 3}
                  textAnchor="start"
                  className="fill-amber-500 text-[9px] tabular-nums"
                >
                  {fmtNum(
                    selicPlot.rMax - f * (selicPlot.rMax - selicPlot.rMin),
                    1
                  )}
                </text>
              )}
            </g>
          );
        })}

        {/* 연도 라벨 */}
        {years.map((y) => (
          <text
            key={y.label}
            x={y.x}
            y={H - 5}
            textAnchor="middle"
            className="fill-zinc-400 text-[9px] tabular-nums"
          >
            {y.label}
          </text>
        ))}

        <polygon points={fxArea} fill="url(#fxArea)" className="text-blue-500" />
        <polyline
          points={fxLine}
          fill="none"
          className="stroke-blue-500"
          strokeWidth={1.5}
          strokeLinejoin="round"
        />

        {selicPlot && (
          <path
            d={selicPlot.line}
            fill="none"
            className="stroke-amber-500"
            strokeWidth={1.25}
          />
        )}

        {hoverT != null && hFxV != null && (
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
            <circle cx={px(hoverT)} cy={fxY(hFxV)} r={3} className="fill-blue-500" />
          </g>
        )}
      </svg>

      <p className="mt-0.5 text-center text-[11px] tabular-nums text-zinc-500 dark:text-zinc-400">
        {hDate ? (
          <>
            {hDate} · {unit} {fmtNum(hFxV ?? 0, digits)}
            {hSelicV != null ? ` · 기준금리 ${fmtNum(hSelicV, 2)}%` : ""}
          </>
        ) : (
          <>
            {fx.dates[0]} ~ {fx.dates[fx.dates.length - 1]}
          </>
        )}
      </p>
    </div>
  );
}
