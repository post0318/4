"use client";

import { useMemo, useState } from "react";
import { fmtNum } from "@/lib/format";
import { toISODate, today } from "@/lib/ntnfPricing";
import {
  simulate,
  sweepShift,
  type Scenario,
  type SimInput,
} from "@/lib/ntnfSimulation";
import type { BondItem, FxRates } from "@/lib/types";
import { RollSwitchComparison } from "@/components/RollSwitchComparison";

interface Props {
  bonds: BondItem[];
  fx: FxRates | null;
}

function addMonthsIso(base: Date, months: number): string {
  const d = new Date(base);
  d.setMonth(d.getMonth() + months);
  return toISODate(d);
}

const box =
  "rounded border border-zinc-300 px-2 py-1.5 text-sm outline-none focus:border-blue-400 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100";

function pct(n: number, digits = 2) {
  return `${n >= 0 ? "+" : ""}${fmtNum(n, digits)}%`;
}

/** 자본/이자/환율 기여도 막대 */
function Contribution({ s }: { s: Scenario }) {
  const parts = [
    { label: "자본", v: s.capitalPct, c: "bg-blue-500" },
    { label: "이자", v: s.couponPct, c: "bg-emerald-500" },
    { label: "환율", v: s.fxPct, c: "bg-amber-500" },
  ];
  const scale = Math.max(1, ...parts.map((p) => Math.abs(p.v)));
  return (
    <div className="space-y-1">
      {parts.map((p) => (
        <div key={p.label} className="flex items-center gap-2 text-[11px]">
          <span className="w-8 shrink-0 text-zinc-500 dark:text-zinc-400">
            {p.label}
          </span>
          <div className="relative h-3 flex-1 rounded bg-zinc-100 dark:bg-zinc-800">
            <div
              className={`absolute top-0 h-3 rounded ${p.c}`}
              style={{
                width: `${(Math.abs(p.v) / scale) * 50}%`,
                left: p.v >= 0 ? "50%" : undefined,
                right: p.v < 0 ? "50%" : undefined,
              }}
            />
            <div className="absolute left-1/2 top-0 h-3 w-px bg-zinc-300 dark:bg-zinc-600" />
          </div>
          <span className="w-16 shrink-0 text-right tabular-nums text-zinc-600 dark:text-zinc-300">
            {pct(p.v)}
          </span>
        </div>
      ))}
    </div>
  );
}

function ScenarioCard({
  s,
  highlight,
}: {
  s: Scenario | null;
  highlight?: boolean;
}) {
  if (!s) return null;
  return (
    <div
      className={`rounded-lg border p-3 ${
        highlight
          ? "border-blue-300 bg-blue-50/50 dark:border-blue-800 dark:bg-blue-950/20"
          : "border-zinc-200 dark:border-zinc-800"
      }`}
    >
      <div className="mb-1 flex items-baseline justify-between">
        <h4 className="text-xs font-semibold text-zinc-800 dark:text-zinc-100">
          {s.label}
        </h4>
        <span className="text-[11px] text-zinc-400">
          ~{s.endDate} · {fmtNum(s.years, 1)}년
        </span>
      </div>
      <div className="mb-2 flex items-baseline gap-3">
        <span className="text-lg font-bold tabular-nums text-zinc-900 dark:text-zinc-100">
          {pct(s.annualKrwPct)}
        </span>
        <span className="text-[11px] text-zinc-500 dark:text-zinc-400">
          원화 연환산 · 헤알 {pct(s.annualBrlPct)}
        </span>
      </div>
      <Contribution s={s} />
      <p className="mt-1 text-right text-[11px] text-zinc-400">
        누적 원화 {pct(s.totalKrwPct, 1)}
      </p>
    </div>
  );
}

/** Δ 스윕 2선 차트 (x: 금리이동 %p, y: 연환산 원화수익률 %) */
function SweepChart({
  data,
}: {
  data: { shift: number; switchKrw: number | null; rolloverKrw: number | null }[];
}) {
  const W = 640;
  const H = 180;
  const P = { t: 10, r: 12, b: 24, l: 40 };
  const vals = data.flatMap((d) =>
    [d.switchKrw, d.rolloverKrw].filter((v): v is number => v != null)
  );
  if (vals.length === 0) return null;
  const xs = data.map((d) => d.shift);
  const x0 = Math.min(...xs);
  const x1 = Math.max(...xs);
  let y0 = Math.min(...vals);
  let y1 = Math.max(...vals);
  const pad = (y1 - y0) * 0.1 || 1;
  y0 -= pad;
  y1 += pad;
  const px = (x: number) =>
    P.l + ((x - x0) / (x1 - x0 || 1)) * (W - P.l - P.r);
  const py = (y: number) =>
    P.t + (1 - (y - y0) / (y1 - y0 || 1)) * (H - P.t - P.b);
  const path = (key: "switchKrw" | "rolloverKrw") => {
    let d = "";
    data.forEach((row) => {
      const v = row[key];
      if (v == null) return;
      d += `${d ? "L" : "M"} ${px(row.shift)} ${py(v)} `;
    });
    return d;
  };
  const zeroY = y0 < 0 && y1 > 0 ? py(0) : null;
  const zeroX = x0 < 0 && x1 > 0 ? px(0) : null;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full">
      {[0, 0.5, 1].map((f) => {
        const y = y1 - f * (y1 - y0);
        const gy = P.t + f * (H - P.t - P.b);
        return (
          <g key={f}>
            <line
              x1={P.l}
              y1={gy}
              x2={W - P.r}
              y2={gy}
              className="stroke-zinc-200 dark:stroke-zinc-800"
            />
            <text
              x={P.l - 4}
              y={gy + 3}
              textAnchor="end"
              className="fill-zinc-400 text-[9px] tabular-nums"
            >
              {fmtNum(y, 1)}
            </text>
          </g>
        );
      })}
      {zeroX != null && (
        <line
          x1={zeroX}
          y1={P.t}
          x2={zeroX}
          y2={H - P.b}
          className="stroke-zinc-300 dark:stroke-zinc-700"
          strokeDasharray="3 3"
        />
      )}
      {zeroY != null && (
        <line
          x1={P.l}
          y1={zeroY}
          x2={W - P.r}
          y2={zeroY}
          className="stroke-zinc-300 dark:stroke-zinc-700"
        />
      )}
      {[x0, (x0 + x1) / 2, x1].map((x) => (
        <text
          key={x}
          x={px(x)}
          y={H - 8}
          textAnchor="middle"
          className="fill-zinc-400 text-[9px] tabular-nums"
        >
          {x >= 0 ? "+" : ""}
          {fmtNum(x, 1)}
        </text>
      ))}
      <path
        d={path("switchKrw")}
        fill="none"
        className="stroke-blue-500"
        strokeWidth={1.75}
      />
      <path
        d={path("rolloverKrw")}
        fill="none"
        className="stroke-amber-500"
        strokeWidth={1.75}
      />
    </svg>
  );
}

export function SimulationPanel({ bonds, fx }: Props) {
  const now = today();
  const sorted = useMemo(
    () => [...bonds].sort((a, b) => a.maturityDate.localeCompare(b.maturityDate)),
    [bonds]
  );

  const [aKey, setAKey] = useState("");
  const [bKey, setBKey] = useState("");
  const [aYield, setAYield] = useState("");
  const [bYield, setBYield] = useState("");
  const [exitDate, setExitDate] = useState(addMonthsIso(now, 12));
  const [shift, setShift] = useState(0);
  const [buyFx, setBuyFx] = useState("");
  const [exitFx, setExitFx] = useState("");

  const bondA = sorted.find((x) => x.maturityDate === aKey) ?? sorted[0];
  const bondB =
    sorted.find((x) => x.maturityDate === bKey) ??
    sorted[sorted.length - 1];

  const liveFx = fx?.krwBrl ?? null;
  const aY =
    aYield !== "" ? parseFloat(aYield) : (bondA?.buyYieldPct ?? NaN);
  const bY =
    bYield !== "" ? parseFloat(bYield) : (bondB?.buyYieldPct ?? NaN);
  const buyFxNum = buyFx !== "" ? parseFloat(buyFx) : (liveFx ?? NaN);
  const exitFxNum = exitFx !== "" ? parseFloat(exitFx) : (liveFx ?? NaN);

  const input: SimInput | null = useMemo(
    () =>
      bondA &&
      bondB &&
      Number.isFinite(aY) &&
      Number.isFinite(bY) &&
      Number.isFinite(buyFxNum) &&
      Number.isFinite(exitFxNum)
        ? {
            bond: { maturity: bondA.maturityDate, yieldPct: aY },
            target: { maturity: bondB.maturityDate, yieldPct: bY },
            exitDate,
            buyFx: buyFxNum,
            exitFx: exitFxNum,
            shiftPct: shift,
          }
        : null,
    [bondA, bondB, aY, bY, buyFxNum, exitFxNum, exitDate, shift]
  );

  const result = useMemo(() => (input ? simulate(input) : null), [input]);
  const sweep = useMemo(() => (input ? sweepShift(input) : []), [input]);

  if (sorted.length === 0) {
    return (
      <section className="rounded-xl border border-zinc-200 bg-white p-4 text-sm text-zinc-500 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-400">
        종목을 불러오는 중입니다.
      </section>
    );
  }

  return (
    <div className="space-y-4">
    <section className="space-y-4 rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-950">
      <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
        시나리오 시뮬레이션
      </h2>

      {/* 입력 */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <label className="block">
          <span className="mb-1 block text-xs text-zinc-500 dark:text-zinc-400">
            보유 종목 (A)
          </span>
          <select
            value={bondA?.maturityDate ?? ""}
            onChange={(e) => {
              setAKey(e.target.value);
              setAYield("");
            }}
            className={`w-full ${box}`}
          >
            {sorted.map((b) => (
              <option key={b.maturityDate} value={b.maturityDate}>
                {b.nameKo} ({b.maturityDate})
              </option>
            ))}
          </select>
        </label>

        <label className="block">
          <span className="mb-1 block text-xs text-zinc-500 dark:text-zinc-400">
            A 매수수익률 (연 %)
          </span>
          <input
            inputMode="decimal"
            value={aYield !== "" ? aYield : (bondA?.buyYieldPct?.toString() ?? "")}
            onChange={(e) => setAYield(e.target.value.replace(/[^\d.]/g, ""))}
            className={`w-full text-right tabular-nums ${box}`}
          />
        </label>

        <label className="block">
          <span className="mb-1 block text-xs text-zinc-500 dark:text-zinc-400">
            중도해지 시점
          </span>
          <input
            type="date"
            value={exitDate}
            min={toISODate(now)}
            max={bondA?.maturityDate}
            onChange={(e) => setExitDate(e.target.value)}
            className={`w-full ${box}`}
          />
        </label>

        <label className="block">
          <span className="mb-1 block text-xs text-zinc-500 dark:text-zinc-400">
            갈아탈/롤오버 종목 (B)
          </span>
          <select
            value={bondB?.maturityDate ?? ""}
            onChange={(e) => {
              setBKey(e.target.value);
              setBYield("");
            }}
            className={`w-full ${box}`}
          >
            {sorted.map((b) => (
              <option key={b.maturityDate} value={b.maturityDate}>
                {b.nameKo} ({b.maturityDate})
              </option>
            ))}
          </select>
        </label>

        <label className="block">
          <span className="mb-1 block text-xs text-zinc-500 dark:text-zinc-400">
            B 매수수익률 (연 %)
          </span>
          <input
            inputMode="decimal"
            value={bYield !== "" ? bYield : (bondB?.buyYieldPct?.toString() ?? "")}
            onChange={(e) => setBYield(e.target.value.replace(/[^\d.]/g, ""))}
            className={`w-full text-right tabular-nums ${box}`}
          />
        </label>

        <div className="grid grid-cols-2 gap-2">
          <label className="block">
            <span className="mb-1 block text-xs text-zinc-500 dark:text-zinc-400">
              매수 환율
            </span>
            <input
              inputMode="decimal"
              placeholder={liveFx ? fmtNum(liveFx, 2) : ""}
              value={buyFx}
              onChange={(e) => setBuyFx(e.target.value.replace(/[^\d.]/g, ""))}
              className={`w-full text-right tabular-nums ${box}`}
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs text-zinc-500 dark:text-zinc-400">
              회수 환율
            </span>
            <input
              inputMode="decimal"
              placeholder={liveFx ? fmtNum(liveFx, 2) : ""}
              value={exitFx}
              onChange={(e) => setExitFx(e.target.value.replace(/[^\d.]/g, ""))}
              className={`w-full text-right tabular-nums ${box}`}
            />
          </label>
        </div>
      </div>

      {/* 금리 이동 슬라이더 */}
      <div>
        <div className="mb-1 flex items-baseline justify-between text-xs">
          <span className="text-zinc-500 dark:text-zinc-400">
            시장금리 평행이동 (매도·재투자)
          </span>
          <span className="font-semibold tabular-nums text-zinc-800 dark:text-zinc-100">
            {shift >= 0 ? "+" : ""}
            {fmtNum(shift, 2)} %p
          </span>
        </div>
        <input
          type="range"
          min={-3}
          max={3}
          step={0.25}
          value={shift}
          onChange={(e) => setShift(parseFloat(e.target.value))}
          className="w-full"
        />
      </div>

      {!result && (
        <p className="text-xs text-zinc-500 dark:text-zinc-400">
          입력값을 확인하세요. (환율 로딩 필요)
        </p>
      )}

      {result && (
        <>
          {/* 중도해지 단독 */}
          {result.exit && (
            <div>
              <h3 className="mb-2 text-xs font-semibold text-zinc-500 dark:text-zinc-400">
                ① 중도해지 (만기 전 매도)
              </h3>
              <ScenarioCard s={result.exit} />
            </div>
          )}

          {/* 갈아타기 vs 롤오버 — 항상 비교 */}
          <div>
            <h3 className="mb-2 text-xs font-semibold text-zinc-500 dark:text-zinc-400">
              ② 갈아타기 vs ③ 롤오버 ·{" "}
              {result.rollover
                ? `${result.rollover.endDate}까지 동일 비교`
                : "비교 불가"}
            </h3>
            <div className="grid gap-3 sm:grid-cols-2">
              <ScenarioCard
                s={result.switch}
                highlight={
                  !!result.switch &&
                  !!result.rollover &&
                  result.switch.annualKrwPct >= result.rollover.annualKrwPct
                }
              />
              <ScenarioCard
                s={result.rollover}
                highlight={
                  !!result.switch &&
                  !!result.rollover &&
                  result.rollover.annualKrwPct > result.switch.annualKrwPct
                }
              />
            </div>
          </div>

          {/* Δ 스윕 차트 */}
          {sweep.length > 0 && (
            <div>
              <div className="mb-1 flex items-center gap-3 text-[11px]">
                <span className="text-zinc-500 dark:text-zinc-400">
                  금리이동별 연환산 원화수익률
                </span>
                <span className="text-blue-600 dark:text-blue-400">■ 갈아타기</span>
                <span className="text-amber-600 dark:text-amber-400">■ 롤오버</span>
              </div>
              <SweepChart data={sweep} />
            </div>
          )}
        </>
      )}

      <p className="text-[11px] text-zinc-400">
        NTN-F(액면 R$1,000, 반기쿠폰 연 10%). 쿠폰은 재투자하지 않고 현금으로
        누적하며, 매도·재투자 시점 금리는 매수금리 + 평행이동입니다. 자본/이자/환율
        기여도의 합은 누적 원화수익률과 같습니다. 참고용 추정치입니다.
      </p>
    </section>

    <RollSwitchComparison bonds={bonds} fx={fx} />
    </div>
  );
}
