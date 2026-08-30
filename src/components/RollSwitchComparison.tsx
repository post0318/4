"use client";

import { useMemo, useState } from "react";
import { fmtInt, fmtNum } from "@/lib/format";
import { toISODate, today } from "@/lib/ntnfPricing";
import {
  simulateRollVsSwitch,
  type RollSwitchInput,
  type RollSwitchLeg,
} from "@/lib/ntnfSimulation";
import type { BondItem, FxRates } from "@/lib/types";

interface Props {
  bonds: BondItem[];
  fx: FxRates | null;
}

const box =
  "w-full rounded border border-zinc-300 px-2 py-1.5 text-sm outline-none focus:border-blue-400 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100";
const numInput = `${box} text-right tabular-nums`;

function pct(n: number, d = 1) {
  return `${n >= 0 ? "+" : ""}${fmtNum(n, d)}%`;
}
function clean(v: string) {
  return v.replace(/[^\d.]/g, "");
}

/** 25 ─ A청산 ─ B만기 타임라인 */
function Timeline({ leg }: { leg: RollSwitchLeg }) {
  const start = today().getFullYear();
  const exitY = new Date(leg.exitDate).getFullYear();
  const endY = new Date(leg.endDate).getFullYear();
  const span = Math.max(1, endY - start);
  const exitX = ((exitY - start) / span) * 100;
  return (
    <div className="my-2">
      <div className="relative h-1 rounded bg-zinc-200 dark:bg-zinc-700">
        <div
          className="absolute -top-1 h-3 w-0.5 bg-zinc-400"
          style={{ left: "0%" }}
        />
        <div
          className="absolute -top-1 h-3 w-0.5 bg-blue-500"
          style={{ left: `${exitX}%` }}
        />
        <div
          className="absolute -top-1 right-0 h-3 w-0.5 bg-zinc-400"
        />
      </div>
      <div className="relative mt-1 h-3 text-[10px] text-zinc-400">
        <span className="absolute left-0">{start}</span>
        <span
          className="absolute -translate-x-1/2 text-blue-500"
          style={{ left: `${Math.min(92, Math.max(8, exitX))}%` }}
        >
          {exitY}
        </span>
        <span className="absolute right-0">{endY}</span>
      </div>
    </div>
  );
}

function Bars({ leg }: { leg: RollSwitchLeg }) {
  const items = [
    { label: "A 만기효과", v: leg.maturityEffectAPct, c: "bg-zinc-400" },
    { label: "B 만기효과", v: leg.maturityEffectBPct, c: "bg-zinc-500" },
    { label: "증분효과", v: leg.incrementPct, c: "bg-orange-400" },
  ];
  const max = Math.max(1, ...items.map((i) => Math.abs(i.v)));
  return (
    <div className="space-y-1">
      {items.map((i) => (
        <div key={i.label} className="flex items-center gap-2 text-[11px]">
          <span className="w-14 shrink-0 text-zinc-500 dark:text-zinc-400">
            {i.label}
          </span>
          <div className="h-2.5 flex-1 rounded bg-zinc-100 dark:bg-zinc-800">
            <div
              className={`h-2.5 rounded ${i.c}`}
              style={{ width: `${(Math.abs(i.v) / max) * 100}%` }}
            />
          </div>
          <span className="w-14 shrink-0 text-right tabular-nums text-zinc-600 dark:text-zinc-300">
            {pct(i.v)}
          </span>
        </div>
      ))}
    </div>
  );
}

function ScenarioCard({
  leg,
  frontFeePct,
  win,
}: {
  leg: RollSwitchLeg | null;
  frontFeePct: number;
  win: boolean;
}) {
  if (!leg)
    return (
      <div className="rounded-lg border border-zinc-200 p-3 text-xs text-zinc-400 dark:border-zinc-800">
        조건을 확인하세요.
      </div>
    );
  return (
    <div
      className={`rounded-lg border p-3 ${
        win
          ? "border-red-300 bg-red-50/40 dark:border-red-800 dark:bg-red-950/20"
          : "border-zinc-200 dark:border-zinc-800"
      }`}
    >
      <h4 className="text-xs font-semibold text-zinc-800 dark:text-zinc-100">
        ■ {leg.label}{" "}
        <span className="font-normal text-zinc-400">
          (선취 {fmtNum(frontFeePct, frontFeePct % 1 ? 1 : 0)}%)
        </span>
      </h4>

      <div className="mt-2 flex items-baseline gap-2">
        <span className="text-[11px] text-zinc-500 dark:text-zinc-400">
          {leg.key === "rollover" ? "만기상환수량" : "중도매도수량"}{" "}
          {fmtInt(leg.unitsStart)} → 신규매수수량 {fmtInt(leg.unitsEnd)}
        </span>
        <span
          className={`rounded px-1 text-xs font-bold ${
            win
              ? "bg-red-100 text-red-600 dark:bg-red-900/40 dark:text-red-300"
              : "bg-orange-100 text-orange-600 dark:bg-orange-900/40 dark:text-orange-300"
          }`}
        >
          {pct(leg.incrementPct)} ↑
        </span>
      </div>

      <Timeline leg={leg} />

      <div className="my-2 flex items-baseline gap-2">
        <span className="text-sm text-zinc-500 dark:text-zinc-400">
          총 기대수익률
        </span>
        <span
          className={`text-lg font-bold tabular-nums ${
            win
              ? "text-red-600 dark:text-red-400"
              : "text-zinc-900 dark:text-zinc-100"
          }`}
        >
          {pct(leg.totalReturnPct)}
        </span>
      </div>

      <Bars leg={leg} />

      <p className="mt-1.5 text-[10px] text-zinc-400">
        A 청산단가 R${fmtNum(leg.exitPriceA, 2)} · B 매수가격 R$
        {fmtNum(leg.buyPriceB, 2)} · {fmtNum(leg.years, 1)}년
      </p>
    </div>
  );
}

export function RollSwitchComparison({ bonds, fx }: Props) {
  const now = today();
  const sorted = useMemo(
    () => [...bonds].sort((a, b) => a.maturityDate.localeCompare(b.maturityDate)),
    [bonds]
  );

  const [units, setUnits] = useState("119000");
  const [aKey, setAKey] = useState("");
  const [bKey, setBKey] = useState("");
  const [aYield, setAYield] = useState("");
  const [bYield, setBYield] = useState("");
  const [sellYield, setSellYield] = useState("");
  const [sellDate, setSellDate] = useState(() => {
    const d = new Date(now);
    d.setFullYear(d.getFullYear() + 1);
    return toISODate(d);
  });
  const [fxRate, setFxRate] = useState("");
  const [feeRoll, setFeeRoll] = useState("0");
  const [feeSwitch, setFeeSwitch] = useState("1.5");
  const [sellPriceA, setSellPriceA] = useState("");
  const [buyPriceB, setBuyPriceB] = useState("");

  const bondA = sorted.find((x) => x.maturityDate === aKey) ?? sorted[0];
  const bondB =
    sorted.find((x) => x.maturityDate === bKey) ?? sorted[sorted.length - 1];
  const liveFx = fx?.krwBrl ?? null;

  const aY = aYield !== "" ? parseFloat(aYield) : (bondA?.buyYieldPct ?? NaN);
  const bY = bYield !== "" ? parseFloat(bYield) : (bondB?.buyYieldPct ?? NaN);
  const sY = sellYield !== "" ? parseFloat(sellYield) : aY;
  const fxN = fxRate !== "" ? parseFloat(fxRate) : (liveFx ?? NaN);

  const input: RollSwitchInput | null = useMemo(() => {
    const u = parseInt(units || "0", 10);
    if (
      !bondA ||
      !bondB ||
      !u ||
      !Number.isFinite(aY) ||
      !Number.isFinite(bY) ||
      !Number.isFinite(fxN)
    )
      return null;
    return {
      units: u,
      bondA: { maturity: bondA.maturityDate, buyYieldPct: aY },
      bondB: { maturity: bondB.maturityDate },
      buyYieldB: bY,
      sellYieldA: Number.isFinite(sY) ? sY : aY,
      sellDate,
      fxKrwPerBrl: fxN,
      frontFeeRollPct: parseFloat(feeRoll) || 0,
      frontFeeSwitchPct: parseFloat(feeSwitch) || 0,
      overrideSellPriceA: sellPriceA !== "" ? parseFloat(sellPriceA) : null,
      overrideBuyPriceB: buyPriceB !== "" ? parseFloat(buyPriceB) : null,
    };
  }, [
    units,
    bondA,
    bondB,
    aY,
    bY,
    sY,
    sellDate,
    fxN,
    feeRoll,
    feeSwitch,
    sellPriceA,
    buyPriceB,
  ]);

  const result = useMemo(
    () => (input ? simulateRollVsSwitch(input) : null),
    [input]
  );

  if (sorted.length === 0) return null;

  const rollWin =
    !!result?.rollover &&
    !!result?.switch &&
    result.rollover.totalReturnPct >= result.switch.totalReturnPct;

  return (
    <section className="space-y-3 rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-950">
      <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
        브라질 국채 시뮬레이션{" "}
        <span className="text-[11px] font-normal text-zinc-400">
          (롤오버 vs 갈아타기 · 수량 증분효과)
        </span>
      </h2>

      <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-4">
        <label className="block">
          <span className="mb-1 block text-xs text-zinc-500 dark:text-zinc-400">
            채권 보유수량 (좌)
          </span>
          <input
            inputMode="numeric"
            value={units}
            onChange={(e) => setUnits(clean(e.target.value))}
            className={numInput}
          />
        </label>
        <label className="block">
          <span className="mb-1 block text-xs text-zinc-500 dark:text-zinc-400">
            보유종목 (A)
          </span>
          <select
            value={bondA?.maturityDate ?? ""}
            onChange={(e) => {
              setAKey(e.target.value);
              setAYield("");
            }}
            className={box}
          >
            {sorted.map((b) => (
              <option key={b.maturityDate} value={b.maturityDate}>
                {b.nameKo}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="mb-1 block text-xs text-zinc-500 dark:text-zinc-400">
            갈아탈 종목 (B)
          </span>
          <select
            value={bondB?.maturityDate ?? ""}
            onChange={(e) => {
              setBKey(e.target.value);
              setBYield("");
            }}
            className={box}
          >
            {sorted.map((b) => (
              <option key={b.maturityDate} value={b.maturityDate}>
                {b.nameKo}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="mb-1 block text-xs text-zinc-500 dark:text-zinc-400">
            헤알화환율 (원/헤알)
          </span>
          <input
            inputMode="decimal"
            placeholder={liveFx ? fmtNum(liveFx, 2) : ""}
            value={fxRate}
            onChange={(e) => setFxRate(clean(e.target.value))}
            className={numInput}
          />
        </label>

        <label className="block">
          <span className="mb-1 block text-xs text-zinc-500 dark:text-zinc-400">
            A 매수수익률 (%)
          </span>
          <input
            inputMode="decimal"
            value={aYield !== "" ? aYield : (bondA?.buyYieldPct?.toString() ?? "")}
            onChange={(e) => setAYield(clean(e.target.value))}
            className={numInput}
          />
        </label>
        <label className="block">
          <span className="mb-1 block text-xs text-zinc-500 dark:text-zinc-400">
            A 중도매도수익률 (%)
          </span>
          <input
            inputMode="decimal"
            placeholder={Number.isFinite(aY) ? String(aY) : ""}
            value={sellYield}
            onChange={(e) => setSellYield(clean(e.target.value))}
            className={numInput}
          />
        </label>
        <label className="block">
          <span className="mb-1 block text-xs text-zinc-500 dark:text-zinc-400">
            B 매수수익률 (%)
          </span>
          <input
            inputMode="decimal"
            value={bYield !== "" ? bYield : (bondB?.buyYieldPct?.toString() ?? "")}
            onChange={(e) => setBYield(clean(e.target.value))}
            className={numInput}
          />
        </label>
        <label className="block">
          <span className="mb-1 block text-xs text-zinc-500 dark:text-zinc-400">
            중도매도 시점
          </span>
          <input
            type="date"
            value={sellDate}
            min={toISODate(now)}
            max={bondA?.maturityDate}
            onChange={(e) => setSellDate(e.target.value)}
            className={box}
          />
        </label>

        <label className="block">
          <span className="mb-1 block text-xs text-zinc-500 dark:text-zinc-400">
            롤오버 선취 (%)
          </span>
          <input
            inputMode="decimal"
            value={feeRoll}
            onChange={(e) => setFeeRoll(clean(e.target.value))}
            className={numInput}
          />
        </label>
        <label className="block">
          <span className="mb-1 block text-xs text-zinc-500 dark:text-zinc-400">
            갈아타기 선취 (%)
          </span>
          <input
            inputMode="decimal"
            value={feeSwitch}
            onChange={(e) => setFeeSwitch(clean(e.target.value))}
            className={numInput}
          />
        </label>
        <label className="block">
          <span className="mb-1 block text-xs text-zinc-500 dark:text-zinc-400">
            A 매도가격 (R$, 선택)
          </span>
          <input
            inputMode="decimal"
            placeholder={
              result?.switch ? fmtNum(result.switch.exitPriceA, 2) : "자동"
            }
            value={sellPriceA}
            onChange={(e) => setSellPriceA(clean(e.target.value))}
            className={numInput}
          />
        </label>
        <label className="block">
          <span className="mb-1 block text-xs text-zinc-500 dark:text-zinc-400">
            B 매수가격 (R$, 선택)
          </span>
          <input
            inputMode="decimal"
            placeholder={
              result?.rollover ? fmtNum(result.rollover.buyPriceB, 2) : "자동"
            }
            value={buyPriceB}
            onChange={(e) => setBuyPriceB(clean(e.target.value))}
            className={numInput}
          />
        </label>
      </div>

      {result && (result.rollover || result.switch) ? (
        <>
          <p className="text-[11px] text-zinc-400">
            보유수량 {fmtInt(parseInt(units || "0", 10))}좌 · A 최초 매수단가 R$
            {fmtNum(result.buyPriceA, 2)}. 두 전략 모두 B({bondB?.nameKo}) 만기에
            종료 · 쿠폰 명목 포함 · 단일환율.
          </p>
          <div className="grid gap-3 sm:grid-cols-2">
            <ScenarioCard
              leg={result.rollover}
              frontFeePct={parseFloat(feeRoll) || 0}
              win={rollWin}
            />
            <ScenarioCard
              leg={result.switch}
              frontFeePct={parseFloat(feeSwitch) || 0}
              win={!rollWin && !!result.switch}
            />
          </div>
        </>
      ) : (
        <p className="text-xs text-zinc-500 dark:text-zinc-400">
          입력값을 확인하세요. (환율 로딩 필요)
        </p>
      )}
    </section>
  );
}
