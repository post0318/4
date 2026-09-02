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
import {
  getOrderSettlementDate,
  parseIsoDate,
  toISODate,
  today,
} from "@/lib/ntnfPricing";
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

/**
 * 갈아타기(switch) 다리가 계산되지 않을 때(`result.switch === null`) 카드에
 * 띄울 구체 사유. `simulateRollVsSwitch`의 `sell > settle && sell < matA` 조건을
 * 사용자 언어로 되돌려준다.
 */
function switchUnavailableReason(
  sellDate: string,
  buyDate: string,
  bondA: BondItem | undefined
): string {
  if (!sellDate) return "중도매도 시점을 입력하세요.";
  const settleISO = toISODate(
    getOrderSettlementDate(parseIsoDate(buyDate) ?? today())
  );
  if (sellDate <= settleISO)
    return `중도매도 시점은 결제일(${settleISO}) 이후여야 합니다.`;
  if (bondA && sellDate >= bondA.maturityDate)
    return `중도매도 시점은 보유종목(A) 만기일(${bondA.maturityDate}) 이전이어야 합니다. 만기일 이후면 "만기상환 후 롤오버"입니다.`;
  return "중도매도 조건을 확인하세요 (환율·매도수익률).";
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
 * 하단 손익 분해 — 예전 화면 구성(왼쪽 A 몫, 오른쪽 B 몫). 네 항(만기효과 A +
 * 만기효과 B + 증분효과 + 이자효과)의 합이 정확히 총기대수익률과 일치한다.
 *  · 만기효과 A = A매도가(롤오버는 액면) ÷ A매수가 − 1 : A 만기·청산 시점 단가 상승
 *  · 만기효과 B = 액면 ÷ B매수가 − 1 : 롤오버 후 B 만기 시점 단가 상승(par 수렴)
 *  · 이자효과   = 받은 쿠폰 ÷ A 보유 액면 : 순수 쿠폰수익률(매수가 무관)
 *  · 증분효과   = 나머지 : A·B 할인이 서로·쿠폰에 곱해진 교차분 + 선취 + 잔돈
 */
function Breakdown({ leg }: { leg: RollSwitchLeg }) {
  const isRoll = leg.key === "rollover";
  const aLabel = isRoll ? "만기효과 A" : "중도매도효과 A";
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
      <div className="grid gap-x-4 gap-y-1 sm:grid-cols-2">
        <div className="flex items-start">
          {row("bg-zinc-400", aLabel, "A 매수가 대비 청산가", leg.maturityEffectAPct)}
        </div>
        <div className="space-y-1">
          {row("bg-zinc-500", "만기효과 B", "B 매수가 대비 액면", leg.maturityEffectBPct)}
          {row("bg-orange-400", "증분효과", "할인 교차분·선취·잔돈", leg.incrementEffectPct)}
        </div>
      </div>
      <div className="border-t border-zinc-100 pt-1 dark:border-zinc-800">
        {row("bg-emerald-500", "이자효과", "쿠폰 ÷ A 보유 액면", leg.couponEffectPct)}
      </div>
    </div>
  );
}

/** 하단 비교 블록 전용 — 예전 화면의 손익분해 구성 그대로 (par 분모 기준). */
function LegacyBreakdown({ leg }: { leg: RollSwitchLeg }) {
  const isRoll = leg.key === "rollover";
  const aLabel = isRoll ? "만기효과" : "중도매도효과";
  const priceRef = isRoll ? "롤오버가격 대비" : "갈아타기가격 대비";
  const qtyRef = isRoll ? "만기상환수량 대비" : "중도매도수량 대비";
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
      <div className="grid gap-x-4 gap-y-1 sm:grid-cols-2">
        <div className="flex items-start">
          {row("bg-zinc-400", aLabel, "", leg.maturityEffectAPct)}
        </div>
        <div className="space-y-1">
          {row("bg-zinc-500", "만기효과", priceRef, leg.maturityEffectBPct)}
          {row("bg-orange-400", "증분효과", qtyRef, leg.incrementPct)}
        </div>
      </div>
      <div className="border-t border-zinc-100 pt-1 dark:border-zinc-800">
        {row("bg-emerald-500", "이자효과", "A·B 쿠폰 명목합", leg.couponEffectPct)}
      </div>
    </div>
  );
}

function ScenarioCard({
  leg,
  frontFeePct,
  win,
  reason,
  legacy = false,
}: {
  leg: RollSwitchLeg | null;
  frontFeePct: number;
  win: boolean;
  reason?: string;
  legacy?: boolean;
}) {
  if (!leg)
    return (
      <div className="rounded-lg border border-zinc-200 p-3 text-xs text-zinc-500 dark:border-zinc-800 dark:text-zinc-400">
        {reason ?? "조건을 확인하세요."}
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

      {legacy ? <LegacyBreakdown leg={leg} /> : <Breakdown leg={leg} />}

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

  // 기본 보유종목(A) = 만기가 오늘로부터 3년 이상 남은 첫 종목(≈2029물). 최단물
  // (27년 등)은 만기가 곧이라 중도매도 후 갈아탈 구간이 거의 없어 기본값에서 뺀다.
  const defaultBondA = useMemo(() => {
    const cutoff = new Date(
      Date.UTC(now.getUTCFullYear() + 3, now.getUTCMonth(), now.getUTCDate())
    )
      .toISOString()
      .slice(0, 10);
    return (
      sorted.find((b) => b.maturityDate >= cutoff) ??
      sorted[Math.min(1, sorted.length - 1)] ??
      sorted[0]
    );
  }, [sorted, now]);

  const bondA =
    sorted.find((x) => x.maturityDate === aKey) ?? defaultBondA;
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
  // 화면 하단 비교용 — 예전 방식(A par = 좌수 × 액면) 분모로 다시 계산.
  const resultLegacy = useMemo(
    () =>
      input
        ? simulateRollVsSwitch({ ...input, legacyParDenominator: true })
        : null,
    [input]
  );

  if (sorted.length === 0) return null;

  const rollWin =
    !!result?.rollover &&
    !!result?.switch &&
    result.rollover.totalReturnPct >= result.switch.totalReturnPct;
  const rollWinLegacy =
    !!resultLegacy?.rollover &&
    !!resultLegacy?.switch &&
    resultLegacy.rollover.totalReturnPct >= resultLegacy.switch.totalReturnPct;

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
            {bondB?.nameKo}) 만기에 종료 · 쿠폰은 받는 즉시 지급하고 총수익률에
            명목 합산(현금흐름 탭과 동일) · 단일환율.
          </p>
          <div className="grid gap-3 sm:grid-cols-2">
            <ScenarioCard
              leg={result.rollover}
              frontFeePct={0}
              win={rollWin}
              reason={
                bondA && bondB && bondB.maturityDate <= bondA.maturityDate
                  ? `갈아탈 종목(B) 만기가 보유종목(A) 만기보다 이르거나 같습니다. B를 더 장기물로 선택하세요.`
                  : undefined
              }
            />
            <ScenarioCard
              leg={result.switch}
              frontFeePct={parseFloat(trustFee) || 0}
              win={!rollWin && !!result.switch}
              reason={switchUnavailableReason(sellDate, buyDate, bondA)}
            />
          </div>
        </>
      ) : (
        <p className="text-xs text-zinc-500 dark:text-zinc-400">
          입력값을 확인하세요. (환율 로딩 필요)
        </p>
      )}
      </section>

      {resultLegacy && (resultLegacy.rollover || resultLegacy.switch) && (
        <section className="space-y-3 rounded-xl border border-dashed border-zinc-300 bg-zinc-50/60 p-4 dark:border-zinc-700 dark:bg-zinc-900/40">
          <h3 className="text-xs font-semibold text-zinc-500 dark:text-zinc-400">
            [비교] 기존 로직 — 분모 = A par(좌수 × 액면)
            <span className="ml-1 font-normal text-zinc-400">
              시각 비교용. 최종본은 위쪽(신탁원금 ÷ 환율).
            </span>
          </h3>
          <div className="grid gap-3 sm:grid-cols-2">
            <ScenarioCard
              leg={resultLegacy.rollover}
              frontFeePct={0}
              win={rollWinLegacy}
              legacy
            />
            <ScenarioCard
              leg={resultLegacy.switch}
              frontFeePct={parseFloat(trustFee) || 0}
              win={!rollWinLegacy && !!resultLegacy.switch}
              legacy
            />
          </div>
        </section>
      )}

      <CashFlowDisclaimer />
    </>
  );
}
