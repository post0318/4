"use client";

import { type FocusEvent, useMemo, useState } from "react";
import { CashFlowDisclaimer } from "@/components/cashflow/CashFlowDisclaimer";
import {
  digitsOnly,
  fmtInt,
  fmtNum,
  groupDigits,
  normalizeDecimalInput,
} from "@/lib/format";
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

/** 포커스 시 기존 값을 전체 선택 — 첫 타이핑이 값을 덮어쓴다 */
const focusSelect = (e: FocusEvent<HTMLInputElement>) => e.currentTarget.select();

function pct(n: number, d = 1) {
  return `${n >= 0 ? "+" : ""}${fmtNum(n, d)}%`;
}
const clean = normalizeDecimalInput;

const DEFAULT_PRINCIPAL_KRW = "100000000";
const DEFAULT_TRUST_FEE = "1.5";

/** 중도매도 시점 기본값 = 최초투자시점 + 1년 */
function defaultSellDate(from: Date): string {
  const d = new Date(from);
  d.setUTCFullYear(d.getUTCFullYear() + 1);
  return toISODate(d);
}

/** 25 ─ A청산 ─ B만기 타임라인 */
function Timeline({ leg }: { leg: RollSwitchLeg }) {
  const start = today().getUTCFullYear();
  const exitY = Number(leg.exitDate.slice(0, 4));
  const endY = Number(leg.endDate.slice(0, 4));
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

/**
 * 하단 손익 분해. 합산부(원금상환효과 + 이자효과)는 정확히 총기대수익률과
 * 일치한다 — 선취신탁보수·잔돈은 원금상환효과에 흡수된다. 그 아래 만기효과
 * A·B와 좌수 증분효과는 "그 값이 왜 그렇게 나왔는지" 보여주는 참고지표로,
 * 합산에는 들어가지 않는다. 롤오버는 A를 만기까지 보유하므로 "A 만기효과",
 * 갈아타기는 중도 시장가 매도라 "A 중도매도효과".
 */
function Breakdown({ leg }: { leg: RollSwitchLeg }) {
  const isRoll = leg.key === "rollover";
  const aLabel = isRoll ? "A 만기효과" : "A 중도매도효과";
  const row = (c: string, label: string, note: string, v: number) => (
    <div className="flex items-baseline gap-1.5">
      <span className={`mt-1 inline-block h-2 w-2 shrink-0 rounded-sm ${c}`} />
      <span className="text-zinc-500 dark:text-zinc-400">
        {label}
        {note && <span className="text-zinc-400"> ({note})</span>}{" "}
        <span className="font-semibold tabular-nums text-zinc-700 dark:text-zinc-200">
          {pct(v)}
        </span>
      </span>
    </div>
  );
  return (
    <div className="mt-1 space-y-1 text-[11px]">
      {row("bg-orange-400", "원금상환효과", "신탁원금 → B 만기상환", leg.principalEffectPct)}
      {row("bg-emerald-500", "이자효과", "A·B 쿠폰 명목합", leg.couponEffectPct)}
      <div className="border-t border-zinc-100 pt-1 text-[10px] text-zinc-400 dark:border-zinc-800">
        참고 · {aLabel} {pct(leg.maturityEffectAPct)} · B 만기효과{" "}
        {pct(leg.maturityEffectBPct)} · 증분효과(좌수) {pct(leg.incrementPct)}
      </div>
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
        ■ {leg.label}
        {frontFeePct > 0 && (
          <span className="font-normal text-zinc-400">
            {" "}
            (선취 {fmtNum(frontFeePct, frontFeePct % 1 ? 1 : 0)}%)
          </span>
        )}
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

      <Breakdown leg={leg} />

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

  const [principalKrw, setPrincipalKrw] = useState(DEFAULT_PRINCIPAL_KRW);
  const [aKey, setAKey] = useState("");
  const [bKey, setBKey] = useState("");
  const [aYield, setAYield] = useState("");
  const [bYield, setBYield] = useState("");
  const [buyDate, setBuyDate] = useState(toISODate(now));
  const [sellYield, setSellYield] = useState("");
  const [sellDate, setSellDate] = useState(() => defaultSellDate(now));
  const [fxRate, setFxRate] = useState("");
  const [trustFee, setTrustFee] = useState(DEFAULT_TRUST_FEE);
  const [buyPriceA, setBuyPriceA] = useState("");
  const [sellPriceA, setSellPriceA] = useState("");

  /** 모든 입력을 기본 세팅으로 되돌린다 */
  const reset = () => {
    const n = today();
    setPrincipalKrw(DEFAULT_PRINCIPAL_KRW);
    setAKey("");
    setBKey("");
    setAYield("");
    setBYield("");
    setBuyDate(toISODate(n));
    setSellYield("");
    setSellDate(defaultSellDate(n));
    setFxRate("");
    setTrustFee(DEFAULT_TRUST_FEE);
    setBuyPriceA("");
    setSellPriceA("");
  };

  const bondA = sorted.find((x) => x.maturityDate === aKey) ?? sorted[0];
  const bondB =
    sorted.find((x) => x.maturityDate === bKey) ?? sorted[sorted.length - 1];
  const liveFx = fx?.krwBrl ?? null;

  const aY = aYield !== "" ? parseFloat(aYield) : (bondA?.buyYieldPct ?? NaN);
  const bY = bYield !== "" ? parseFloat(bYield) : (bondB?.buyYieldPct ?? NaN);
  const sY = sellYield !== "" ? parseFloat(sellYield) : aY;
  const fxN = fxRate !== "" ? parseFloat(fxRate) : (liveFx ?? NaN);

  const input: RollSwitchInput | null = useMemo(() => {
    const p = parseFloat(principalKrw || "0");
    if (
      !bondA ||
      !bondB ||
      !p ||
      !Number.isFinite(aY) ||
      !Number.isFinite(bY) ||
      !Number.isFinite(fxN)
    )
      return null;
    const fee = parseFloat(trustFee) || 0;
    return {
      principalKrw: p,
      buyDate,
      bondA: { maturity: bondA.maturityDate, buyYieldPct: aY },
      bondB: { maturity: bondB.maturityDate },
      buyYieldB: bY,
      sellYieldA: Number.isFinite(sY) ? sY : aY,
      sellDate,
      fxKrwPerBrl: fxN,
      frontFeeInitialPct: fee,
      frontFeeRollPct: 0,
      frontFeeSwitchPct: fee,
      overrideBuyPriceA: buyPriceA !== "" ? parseFloat(buyPriceA) : null,
      overrideSellPriceA: sellPriceA !== "" ? parseFloat(sellPriceA) : null,
    };
  }, [
    principalKrw,
    buyDate,
    bondA,
    bondB,
    aY,
    bY,
    sY,
    sellDate,
    fxN,
    trustFee,
    buyPriceA,
    sellPriceA,
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
    <>
      <section className="space-y-3 rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-950">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
          시뮬레이션{" "}
          <span className="text-[11px] font-normal text-zinc-400">
            (롤오버 vs 갈아타기)
          </span>
        </h2>
        <button
          type="button"
          onClick={reset}
          className="shrink-0 rounded-md border border-zinc-300 px-2.5 py-1 text-xs font-medium text-zinc-600 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-900"
        >
          초기화
        </button>
      </div>

      <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-4">
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
            최초투자시점
          </span>
          <input
            type="date"
            value={buyDate}
            max={bondA?.maturityDate}
            onChange={(e) => setBuyDate(e.target.value)}
            className={box}
          />
        </label>
        <label className="block">
          <span className="mb-1 block text-xs text-zinc-500 dark:text-zinc-400">
            A 매수수익률 (%)
          </span>
          <input
            onFocus={focusSelect}
            inputMode="decimal"
            value={aYield !== "" ? aYield : (bondA?.buyYieldPct?.toString() ?? "")}
            onChange={(e) => setAYield(clean(e.target.value))}
            className={numInput}
          />
        </label>
        <label className="block">
          <span className="mb-1 block text-xs text-zinc-500 dark:text-zinc-400">
            A 매수가격 (R$, 선택)
          </span>
          <input
            onFocus={focusSelect}
            inputMode="decimal"
            placeholder={result ? fmtNum(result.buyPriceA, 2) : "자동"}
            value={buyPriceA}
            onChange={(e) => setBuyPriceA(clean(e.target.value))}
            className={numInput}
          />
        </label>
        <label className="block">
          <span className="mb-1 block text-xs text-zinc-500 dark:text-zinc-400">
            신탁투자원금 (원)
          </span>
          <input
            onFocus={focusSelect}
            inputMode="numeric"
            value={groupDigits(principalKrw)}
            onChange={(e) => setPrincipalKrw(digitsOnly(e.target.value))}
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
            min={buyDate || toISODate(now)}
            max={bondA?.maturityDate}
            onChange={(e) => setSellDate(e.target.value)}
            className={box}
          />
        </label>
        <label className="block">
          <span className="mb-1 block text-xs text-zinc-500 dark:text-zinc-400">
            A 중도매도수익률 (%)
          </span>
          <input
            onFocus={focusSelect}
            inputMode="decimal"
            placeholder={Number.isFinite(aY) ? String(aY) : ""}
            value={sellYield}
            onChange={(e) => setSellYield(clean(e.target.value))}
            className={numInput}
          />
        </label>
        <label className="block">
          <span className="mb-1 block text-xs text-zinc-500 dark:text-zinc-400">
            A 매도가격 (R$, 선택)
          </span>
          <input
            onFocus={focusSelect}
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
            B 매수수익률 (%)
          </span>
          <input
            onFocus={focusSelect}
            inputMode="decimal"
            value={bYield !== "" ? bYield : (bondB?.buyYieldPct?.toString() ?? "")}
            onChange={(e) => setBYield(clean(e.target.value))}
            className={numInput}
          />
        </label>
        <label className="block">
          <span className="mb-1 block text-xs text-zinc-500 dark:text-zinc-400">
            신탁보수 선취 (%)
          </span>
          <input
            onFocus={focusSelect}
            inputMode="decimal"
            value={trustFee}
            onChange={(e) => setTrustFee(clean(e.target.value))}
            className={numInput}
          />
        </label>
        <label className="block">
          <span className="mb-1 block text-xs text-zinc-500 dark:text-zinc-400">
            헤알화환율 (원/헤알)
          </span>
          <input
            onFocus={focusSelect}
            inputMode="decimal"
            placeholder={liveFx ? fmtNum(liveFx, 2) : ""}
            value={fxRate}
            onChange={(e) => setFxRate(clean(e.target.value))}
            className={numInput}
          />
        </label>
      </div>

      {result && (result.rollover || result.switch) ? (
        <>
          <p className="text-[11px] text-zinc-400">
            {buyDate} 투자 · 신탁원금 {fmtInt(parseFloat(principalKrw) || 0)}원
            (선취 {fmtNum(parseFloat(trustFee) || 0, 1)}%,{" "}
            {fmtInt(result.frontFeeKrw)}원) → A {fmtInt(result.units)}좌 매수 ·
            최초 매수단가 R${fmtNum(result.buyPriceA, 2)}. 두 전략 모두 B(
            {bondB?.nameKo}) 만기에 종료 · 쿠폰은 재투자 없이 명목 합산(현금 보유
            가정) · 단일환율.
          </p>
          <div className="grid gap-3 sm:grid-cols-2">
            <ScenarioCard
              leg={result.rollover}
              frontFeePct={0}
              win={rollWin}
            />
            <ScenarioCard
              leg={result.switch}
              frontFeePct={parseFloat(trustFee) || 0}
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

      <CashFlowDisclaimer />
    </>
  );
}
