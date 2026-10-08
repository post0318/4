"use client";

import { useMemo, useState } from "react";
import { fmtNum } from "@/lib/format";

export interface ChartSeries {
  /** ISO 날짜, 오름차순 */
  dates: string[];
  values: number[];
}

interface Overlay {
  series: ChartSeries;
  label: string;
  stepped?: boolean;
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
  /**
   * 눈금의 **기준** 범위(금리 차트 0~17%). 값이 이 범위를 벗어나면 정수 단위로
   * 그만큼만 넓힌다 — 넓게 잡아두면 선이 평탄해 보이고, 좁게 고정하면 말없이
   * 잘린다(오너 지시 2026-09-22). 겹쳐 그린 선도 같은 눈금을 쓴다 — 두 선의
   * 높낮이를 그대로 비교하려면 축이 하나여야 한다.
   */
  yAxis?: { min: number; max: number };
  /** 같은 축에 겹쳐 그릴 두 번째 선 (예: 10년국채수익률 vs 기준금리) */
  overlay?: Overlay;
  /**
   * 오른쪽 위 변화율을 "통화 강세/약세" 관점으로 표시할 때 지정.
   * name: 관점의 주체 통화("헤알"·"달러"), invert: 시계열 상승이 곧 약세면 true
   * (예: R$/USD 상승 = 헤알 약세 → invert:true).
   */
  strength?: { name: string; invert?: boolean };
  range: RangeKey;
  onRangeChange: (r: RangeKey) => void;
}

export const RANGES = [
  { key: "1m", label: "1개월", months: 1 },
  { key: "3m", label: "3개월", months: 3 },
  { key: "6m", label: "6개월", months: 6 },
  { key: "1y", label: "1년", months: 12 },
  { key: "3y", label: "3년", months: 36 },
  { key: "5y", label: "5년", months: 60 },
  { key: "max", label: "최대", months: 0 },
] as const;
export type RangeKey = (typeof RANGES)[number]["key"];
export const DEFAULT_RANGE: RangeKey = "1y";

const W = 900;
const H = 140;
const PAD = { top: 8, right: 10, bottom: 16, left: 52 };

const t = (iso: string) => new Date(iso).getTime();

function valueAt(series: ChartSeries, time: number): number | null {
  let v: number | null = null;
  for (let i = 0; i < series.dates.length; i++) {
    if (t(series.dates[i]) <= time) v = series.values[i];
    else break;
  }
  return v ?? series.values[0] ?? null;
}

/** 마지막 데이터 날짜 기준 months 개월 전 ISO 날짜 (0 = 전체) */
function cutoffIso(lastIso: string, months: number): string | null {
  if (!months) return null;
  const d = new Date(`${lastIso}T00:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() - months);
  return d.toISOString().slice(0, 10);
}

function sliceFrom(s: ChartSeries, cutoff: string | null, carry: boolean): ChartSeries {
  if (!cutoff) return s;
  let i = s.dates.findIndex((d) => d >= cutoff);
  if (i < 0) i = s.dates.length;
  const dates = s.dates.slice(i);
  const values = s.values.slice(i);
  // 계단식 겹선은 구간 시작 시점의 값을 이어받아 그린다
  if (carry && i > 0 && (dates.length === 0 || dates[0] > cutoff)) {
    dates.unshift(cutoff);
    values.unshift(s.values[i - 1]);
  }
  return { dates, values };
}

function buildPath(
  s: ChartSeries,
  px: (time: number) => number,
  y: (v: number) => number,
  stepped: boolean
): string {
  let d = "";
  s.dates.forEach((date, i) => {
    const x = px(t(date));
    const yy = y(s.values[i]);
    if (i === 0) d = `M ${x} ${yy}`;
    else if (stepped) d += ` H ${x} V ${yy}`;
    else d += ` L ${x} ${yy}`;
  });
  return d;
}

export function FxHistoryChart({
  label,
  unit,
  suffix = "",
  digits,
  stepped = false,
  series: fullSeries,
  yAxis,
  overlay: fullOverlay,
  strength,
  range,
  onRangeChange,
}: FxHistoryChartProps) {
  const [hoverT, setHoverT] = useState<number | null>(null);

  const { series, overlay, shortFrom } = useMemo(() => {
    const months = RANGES.find((r) => r.key === range)?.months ?? 0;
    const lastIso = fullSeries.dates[fullSeries.dates.length - 1];
    const cutoff = lastIso ? cutoffIso(lastIso, months) : null;
    const sliced = sliceFrom(fullSeries, cutoff, false);
    const ov = fullOverlay
      ? { ...fullOverlay, series: sliceFrom(fullOverlay.series, cutoff, !!fullOverlay.stepped) }
      : undefined;
    // 데이터가 요청 기간보다 짧으면 시작일 안내
    const short = cutoff && fullSeries.dates[0] > cutoff ? fullSeries.dates[0] : null;
    return { series: sliced, overlay: ov, shortFrom: short };
  }, [fullSeries, fullOverlay, range]);

  const chart = useMemo(() => {
    const n = series.dates.length;
    if (n === 0) return null;

    const t0 = t(series.dates[0]);
    const t1 = t(series.dates[n - 1]);
    const plotW = W - PAD.left - PAD.right;
    const plotH = H - PAD.top - PAD.bottom;
    const px = (time: number) =>
      PAD.left + ((time - t0) / (t1 - t0 || 1)) * plotW;

    const all = overlay
      ? [
          ...series.values,
          ...overlay.series.dates
            .map((d, i) =>
              t(d) >= t0 && t(d) <= t1 ? overlay.series.values[i] : null
            )
            .filter((v): v is number => v != null),
        ]
      : series.values;
    const min = Math.min(...all);
    const max = Math.max(...all);
    const span = max - min || 1;
    /*
     * 고정 눈금(yAxis)은 **기준일 뿐** 상한이 아니다 — 값이 넘으면 딱 그만큼만
     * 넓힌다(오너 지시 2026-09-22). 넉넉하게 잡아두면 선이 가운데 눌려 평탄해
     * 보이고, 좁게 고정하면 넘는 순간 말없이 잘린다. 그 사이를 취한다.
     */
    const yMin = yAxis ? Math.min(yAxis.min, Math.floor(min)) : min - span * 0.1;
    const yMax = yAxis ? Math.max(yAxis.max, Math.ceil(max)) : max + span * 0.1;
    // 눈금 위치 — 고정축이면 위·가운데·아래(0·중간·상한), 아니면 같은 셋
    const ticks = [0, 0.5, 1];
    const y = (v: number) =>
      PAD.top + plotH - ((v - yMin) / (yMax - yMin)) * plotH;

    const path = buildPath(series, px, y, stepped);
    const area = `${path} L ${px(t1)} ${PAD.top + plotH} L ${PAD.left} ${
      PAD.top + plotH
    } Z`;
    const overlayPath = overlay
      ? buildPath(overlay.series, px, y, overlay.stepped ?? false)
      : null;

    const years: { x: number; label: string }[] = [];
    for (
      let yr = new Date(t0).getFullYear();
      yr <= new Date(t1).getFullYear();
      yr++
    ) {
      const time = new Date(`${yr}-01-01`).getTime();
      if (time >= t0 && time <= t1) years.push({ x: px(time), label: `${yr}` });
    }

    return { t0, t1, plotH, px, y, yMin, yMax, ticks, path, area, overlayPath, years };
  }, [series, stepped, yAxis, overlay]);

  if (!chart) return null;

  const {
    t0,
    t1,
    plotH,
    px,
    y,
    yMin,
    yMax,
    ticks,
    path,
    area,
    overlayPath,
    years,
  } = chart;
  const first = series.values[0];
  const last = series.values[series.values.length - 1];
  const change = last - first;
  const changePct = (change / first) * 100;

  // "통화 강세/약세" 관점: invert면 시계열 상승이 약세이므로 부호를 뒤집는다.
  const strengthPct = strength?.invert
    ? (first / last - 1) * 100
    : (last / first - 1) * 100;

  const hv = hoverT != null ? valueAt(series, hoverT) : null;
  const hov = hoverT != null && overlay ? valueAt(overlay.series, hoverT) : null;
  const hDate =
    hoverT != null ? new Date(hoverT).toISOString().slice(0, 10) : null;

  const fmtVal = (v: number) =>
    `${unit ? unit + " " : ""}${fmtNum(v, digits)}${suffix}`;

  return (
    <div className="mt-2 rounded-lg border border-zinc-200 bg-zinc-50 p-2 dark:border-zinc-800 dark:bg-zinc-900">
      <div className="mb-0.5 flex flex-wrap items-baseline justify-between gap-x-3">
        <p className="text-[11px] font-semibold text-zinc-700 dark:text-zinc-200">
          <span className="text-blue-600 dark:text-blue-400">■</span> {label}
          {overlay && (
            <>
              {"  "}
              <span className="text-amber-600 dark:text-amber-400">■</span>{" "}
              {overlay.label}
            </>
          )}
          <span className="ml-1 font-normal text-zinc-400">
            · {RANGES.find((r) => r.key === range)?.label}
          </span>
        </p>
        {!overlay && (
          <p className="text-[10px] tabular-nums text-zinc-400">
            {series.dates[0]} 대비{" "}
            {strength ? (
              <span
                className={
                  strengthPct >= 0
                    ? "font-semibold text-emerald-600 dark:text-emerald-400"
                    : "font-semibold text-red-600 dark:text-red-400"
                }
              >
                {strength.name} {strengthPct >= 0 ? "+" : ""}
                {fmtNum(strengthPct, 1)}% ({strengthPct >= 0 ? "강세" : "약세"})
              </span>
            ) : (
              <span
                className={
                  change >= 0
                    ? "font-semibold text-emerald-600 dark:text-emerald-400"
                    : "font-semibold text-red-600 dark:text-red-400"
                }
              >
                {change >= 0 ? "+" : ""}
                {fmtNum(change, digits)} ({changePct >= 0 ? "+" : ""}
                {fmtNum(changePct, 1)}%)
              </span>
            )}
          </p>
        )}
      </div>

      <div className="mb-1 flex flex-wrap items-center gap-1">
        {RANGES.map((r) => (
          <button
            key={r.key}
            type="button"
            onClick={() => onRangeChange(r.key)}
            aria-pressed={range === r.key}
            className={
              range === r.key
                ? "rounded-md border border-blue-300 bg-blue-50 px-2 py-0.5 text-[11px] font-medium text-blue-700 dark:border-blue-800 dark:bg-blue-950/40 dark:text-blue-300"
                : "rounded-md border border-transparent px-2 py-0.5 text-[11px] text-zinc-500 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-800"
            }
          >
            {r.label}
          </button>
        ))}
        {shortFrom && (
          <span className="ml-1 text-[10px] text-zinc-400">
            데이터 시작 {shortFrom}
          </span>
        )}
      </div>

      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="w-full"
        role="img"
        aria-label={`${label} 추이 차트`}
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

        {ticks.map((f) => {
          const v = yMax - f * (yMax - yMin);
          const gy = PAD.top + f * plotH;
          // 가로선은 0 선까지 모두 없앤다(오너 지시 2026-09-22) — 눈금은
          // 숫자로 읽고, 시간축은 세로 연도 점선이 나눈다.
          return (
            <g key={f}>
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

        {/* 연도 경계도 세로 점선으로 나눈다(오너 지시 2026-09-22) */}
        {years.map((yr) => (
          <g key={yr.label}>
            <line
              x1={yr.x}
              y1={PAD.top}
              x2={yr.x}
              y2={PAD.top + plotH}
              className="stroke-zinc-300 dark:stroke-zinc-700"
              strokeWidth={1}
              strokeDasharray="3 3"
            />
            <text
              x={yr.x}
              y={H - 5}
              textAnchor="middle"
              className="fill-zinc-400 text-[9px] tabular-nums"
            >
              {yr.label}
            </text>
          </g>
        ))}

        {/*
          아래를 칠하는 건 축이 값 범위에 붙어 있는 환율 차트에서만 뜻이 있다.
          고정 기준축(금리 차트)은 바닥이 0% 라, Selic 조회가 실패해 선이 하나만
          남으면 14% 선부터 0 까지 통째로 칠해졌다(점검 C).
        */}
        {!overlay && !yAxis && (
          <path d={area} fill="url(#fxArea)" className="text-blue-500" />
        )}
        <path
          d={path}
          fill="none"
          className="stroke-blue-500"
          strokeWidth={1.5}
          strokeLinejoin="round"
        />
        {overlayPath && (
          <path
            d={overlayPath}
            fill="none"
            className="stroke-amber-500"
            strokeWidth={1.25}
          />
        )}

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
            {hov != null && (
              <circle
                cx={px(hoverT)}
                cy={y(hov)}
                r={3}
                className="fill-amber-500"
              />
            )}
          </g>
        )}
      </svg>

      <p className="mt-0.5 text-center text-[11px] tabular-nums text-zinc-500 dark:text-zinc-400">
        {hDate && hv != null ? (
          <>
            {hDate} ·{" "}
            <span className="text-blue-600 dark:text-blue-400">
              {/* 이름은 항상 붙인다 — 겹선이 사라져도(조회 실패) 무슨 값인지 남게 */}
              {`${label} `}
              {fmtVal(hv)}
            </span>
            {hov != null && overlay && (
              <>
                {" · "}
                <span className="text-amber-600 dark:text-amber-400">
                  {overlay.label} {fmtNum(hov, digits)}
                  {suffix}
                </span>
              </>
            )}
          </>
        ) : overlay ? (
          <>
            {series.dates[0]} ~ {series.dates[series.dates.length - 1]}
          </>
        ) : (
          <span className="text-zinc-400">
            그래프에 마우스를 올리면 해당일 값이 표시됩니다
          </span>
        )}
      </p>
    </div>
  );
}
