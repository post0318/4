"use client";

import {
  type Dispatch,
  type FocusEvent,
  type ReactNode,
  type SetStateAction,
  useMemo,
} from "react";
import { CashFlowDisclaimer } from "@/components/cashflow/CashFlowDisclaimer";
import {
  digitsOnly,
  fmtInt,
  fmtNum,
  groupDigits,
  normalizeDecimalInput,
} from "@/lib/format";
import { parseIsoDate, toISODate, today } from "@/lib/ntnfPricing";
import { impliedYieldFromBrazilPrice } from "@/lib/cashflow/bondPricing";
import { getSettlementDate } from "@/lib/cashflow/couponSchedule";
import {
  simulateEarlyTermination,
  simulateHold,
  simulateReinvestRollover,
  simulateReinvestSwitch,
  simulateRollover,
  simulateSwitch,
  type TrustSimInput,
  type TrustStrategyResult,
} from "@/lib/cashflow/trustSimulation";
import type { CalcBasis, CouponFrequency, TaxStatus } from "@/lib/cashflow/bondLayout";
import {
  createSimulationState,
  type SimulationState,
} from "@/lib/simulationState";
import type { BondItem, FxRates } from "@/lib/types";

/**
 * 시뮬레이션 탭 — **현금흐름 탭과 같은 엔진**(`trustSimulation`)으로 네 전략을
 * 비교한다.
 *
 * 입력은 이 탭이 직접 받는다. 현금흐름 탭 입력을 참조하면 그 탭을 채우기 전에는
 * 시뮬레이션이 아예 뜨지 않아서다 — 가져올 것은 화면이 아니라 **로직**이라는
 * 결론(2026-09-17). 화면 구성은 「시뮬레이션 원본」 탭 그대로 4열 × 4행이다.
 *
 * 표면이율(10%)·이자지급주기(6개월)·계산기준(Business/252)·종합소득세율
 * (15.4%)·과세여부(비과세)·롤오버 선취보수(0%)·현금성이율(0%)은 브라질 국채에서
 * 달라지지 않아 입력으로 두지 않는다.
 */

interface Props {
  bonds: BondItem[];
  fx: FxRates | null;
  state: SimulationState;
  onChange: Dispatch<SetStateAction<SimulationState>>;
}

/** NTN-F 고정 제원 — 종목을 바꿔도 달라지지 않는다 */
const NTNF_COUPON_PCT = 10;
const NTNF_FREQUENCY: CouponFrequency = "6개월";
const NTNF_BASIS: CalcBasis = "Business/252";
const NTNF_FACE = 1000;
const COMPREHENSIVE_TAX_PCT = 15.4;
/** 브라질 국채 이자는 한·브 조세조약상 비과세 — 선택지를 두지 않는다 */
const NTNF_TAX_STATUS: TaxStatus = "비과세";

const box =
  "w-full rounded border border-zinc-300 px-2 py-1.5 text-sm outline-none focus:border-blue-400 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100";
const numInput = `${box} text-right tabular-nums`;
const focusSelect = (e: FocusEvent<HTMLInputElement>) => e.currentTarget.select();
const clean = normalizeDecimalInput;

const num = (s: string, fallback = 0) => {
  const v = parseFloat(s);
  return Number.isFinite(v) ? v : fallback;
};

function pct(n: number, d = 1) {
  return `${n >= 0 ? "+" : ""}${fmtNum(n, d)}%`;
}

/**
 * 원본 시뮬레이션의 전략 카드에 쓰던 지표를 **새 엔진 결과**로 다시 구한다.
 * 이 카드가 시뮬레이션의 핵심 화면이라 구성을 그대로 가져왔다(오너 지시, 2026-09-17).
 *
 * 분해식은 원본 그대로 네 항이고 합이 총수익률과 정확히 맞는다(증분효과가 잔차).
 *  · 만기효과 A = A 청산단가(롤오버는 액면) ÷ A 매수단가 − 1
 *  · 만기효과 B = 액면 ÷ B 매수단가 − 1 (만기 par 수렴)
 *  · 이자효과   = 받은 쿠폰 ÷ A 보유 액면 (순수 쿠폰수익률, 매수가 무관)
 *  · 증분효과   = 나머지
 *
 * 다만 총수익률이 원본(헤알 명목)과 달리 **현금흐름 엔진의 세후 원화 수익률**
 * 이라, 잔차인 증분효과가 후취보수·세금까지 함께 떠안는다. 카드의 총 기대수익률과
 * 아래 표의 총수익률이 어긋나지 않으려면 이쪽이 맞다.
 */
interface CardMetrics {
  label: string;
  kind: "rollover" | "switch";
  unitsStart: number;
  unitsEnd: number;
  incrementPct: number;
  startYear: number;
  exitDate: string;
  endDate: string;
  years: number;
  totalReturnPct: number;
  maturityEffectAPct: number;
  maturityEffectBPct: number;
  couponEffectPct: number;
  incrementEffectPct: number;
  exitPriceA: number;
  buyPriceB: number;
}

function cardMetrics(
  kind: "rollover" | "switch",
  label: string,
  r: TrustStrategyResult | null,
  fxRate: number,
  contractDate: string
): CardMetrics | null {
  if (!r || r.legs.length < 2 || !(fxRate > 0)) return null;
  const [a, b] = r.legs;
  const unitsStart = a.pricing.faceValue / NTNF_FACE;
  const unitsEnd = b.pricing.faceValue / NTNF_FACE;
  const puA = a.pricing.dirtyPrice;
  const puB = b.pricing.dirtyPrice;
  if (!(unitsStart > 0) || !(puA > 0) || !(puB > 0)) return null;
  // 롤오버는 A 를 만기상환(액면)으로 끝내고, 갈아타기는 청산단가로 판다
  const exitPriceA = kind === "rollover" ? NTNF_FACE : (a.exitPrice ?? NTNF_FACE);
  // 쿠폰은 두 구간 합. 엔진이 수탁통화(원)로 주므로 헤알로 되돌린다
  const couponBrl =
    r.legs.reduce(
      (sum, leg) => sum + leg.rows.reduce((t, row) => t + row.interest, 0),
      0
    ) / fxRate;

  const total = r.totalReturnPct / 100;
  const mA = exitPriceA / puA - 1;
  const mB = NTNF_FACE / puB - 1;
  const cE = couponBrl / (unitsStart * NTNF_FACE);
  return {
    label,
    kind,
    unitsStart,
    unitsEnd,
    incrementPct: (unitsEnd / unitsStart - 1) * 100,
    startYear: Number(contractDate.slice(0, 4)),
    exitDate: kind === "rollover" ? a.bondMaturity : a.endDate,
    endDate: r.endDate,
    years: r.days / 365,
    totalReturnPct: r.totalReturnPct,
    maturityEffectAPct: mA * 100,
    maturityEffectBPct: mB * 100,
    couponEffectPct: cE * 100,
    incrementEffectPct: (total - mA - mB - cE) * 100,
    exitPriceA,
    buyPriceB: puB,
  };
}

/** 계약연도 ─ 전환연도 ─ 종료연도 한 줄 막대 (원본 그대로) */
function Timeline({ m }: { m: CardMetrics }) {
  const start = m.startYear;
  const exitY = Number(m.exitDate.slice(0, 4));
  const endY = Number(m.endDate.slice(0, 4));
  const span = Math.max(1, endY - start);
  const exitX = ((exitY - start) / span) * 100;
  return (
    <div className="my-2">
      <div className="relative h-1 rounded bg-zinc-200 dark:bg-zinc-700">
        <div className="absolute -top-1 h-3 w-0.5 bg-zinc-400" style={{ left: "0%" }} />
        <div
          className="absolute -top-1 h-3 w-0.5 bg-blue-500"
          style={{ left: `${exitX}%` }}
        />
        <div className="absolute -top-1 right-0 h-3 w-0.5 bg-zinc-400" />
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

/** 하단 손익 분해 — 왼쪽 A 몫, 오른쪽 B 몫 (원본 그대로) */
function Breakdown({ m }: { m: CardMetrics }) {
  const aLabel = m.kind === "rollover" ? "만기효과 A" : "중도매도효과 A";
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
          {row("bg-zinc-400", aLabel, "A 매수가 대비 청산가", m.maturityEffectAPct)}
        </div>
        <div className="space-y-1">
          {row("bg-zinc-500", "만기효과 B", "B 매수가 대비 액면", m.maturityEffectBPct)}
          {row(
            "bg-orange-400",
            "증분효과",
            "할인 교차분·선취·후취·세금·잔돈",
            m.incrementEffectPct
          )}
        </div>
      </div>
      <div className="mt-1 border-t border-zinc-300 pt-1.5 dark:border-zinc-600">
        {row("bg-emerald-500", "이자효과", "쿠폰 ÷ A 보유 액면", m.couponEffectPct)}
      </div>
    </div>
  );
}

function ScenarioCard({
  m,
  frontFeePct,
  win,
  reason,
}: {
  m: CardMetrics | null;
  frontFeePct: number;
  win: boolean;
  reason?: string;
}) {
  if (!m)
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
        ■ {m.label}
        {frontFeePct > 0 && (
          <span className="font-normal text-zinc-400">
            {" "}
            (선취 {fmtNum(frontFeePct, frontFeePct % 1 ? 1 : 0)}%)
          </span>
        )}
      </h4>

      <div className="mt-2 flex items-baseline gap-2">
        <span className="text-[11px] text-zinc-500 dark:text-zinc-400">
          {m.kind === "rollover" ? "만기상환수량" : "중도매도수량"}{" "}
          {fmtInt(m.unitsStart)} → 신규매수수량 {fmtInt(m.unitsEnd)}
        </span>
        <span
          className={`rounded px-1 text-xs font-bold ${
            win
              ? "bg-red-100 text-red-600 dark:bg-red-900/40 dark:text-red-300"
              : "bg-orange-100 text-orange-600 dark:bg-orange-900/40 dark:text-orange-300"
          }`}
        >
          {pct(m.incrementPct)} &uarr;
        </span>
      </div>

      <Timeline m={m} />

      <div className="my-2 flex items-baseline gap-2">
        <span className="text-sm text-zinc-500 dark:text-zinc-400">총 기대수익률</span>
        <span
          className={`text-lg font-bold tabular-nums ${
            win ? "text-red-600 dark:text-red-400" : "text-zinc-900 dark:text-zinc-100"
          }`}
        >
          {pct(m.totalReturnPct)}
        </span>
      </div>

      <Breakdown m={m} />

      <p className="mt-1.5 text-[10px] text-zinc-400">
        A 청산단가 R${fmtNum(m.exitPriceA, 2)} &middot; B 매수가격 R$
        {fmtNum(m.buyPriceB, 2)} &middot; {fmtNum(m.years, 1)}년
      </p>
    </div>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs text-zinc-500 dark:text-zinc-400">
        {label}
      </span>
      {children}
    </label>
  );
}

/**
 * 화면 배치 — 4열 × 4행. `null`은 사용자가 지정한 빈칸이다.
 * 3행은 환율·수익률, 4행은 같은 열에 대응하는 가격이다(오너 지정) —
 * 헤알화환율/매도시환율 · A매수수익률/A매수가격 · A중도매도수익률/A매도가격 ·
 * B매수수익률/B매수가격. 2행은 보유종목A · 최초투자시점 · 중도매도 시점 ·
 * 갈아탈 종목B 순이다.
 * 배치를 바꿀 때는 이 배열만 손대면 된다.
 */
// PC(태블릿 이상)용 원래 순서 — 모바일과 다르게 별도 구성한다(오너 지시,
// "모바일과 피시용은 다르게 디자인구성한다"). 모바일 전용 재배치가 여기 영향을
// 주지 않도록 PC 순서는 이 배열에서만 관리한다.
const SLOT_ORDER = [
  "principal", "trustFee",   "backFee",    null,
  "bondA",     "buyDate",    "sellDate",   "bondB",
  "fxRate",     "aYield",    "sellYield",  "bYield",
  "exitFxRate", "buyPriceA", "sellPriceA", "buyPriceB",
] as const;

type SlotKey = Exclude<(typeof SLOT_ORDER)[number], null>;

/**
 * 모바일 1행(신탁조건) — principal·trustFee·backFee 3개 + 빈칸 1개, PC와 동일한
 * 구성·점선 구분을 유지한다(오너 지시, "1,2,3,공란 점선은 동일"). PC에서는 이
 * 빈칸이 lg 미만에서 `hidden`이라 모바일에서 backFee가 혼자 남았던 것을,
 * 여기서는 빈 칸을 그대로 보여줘 "1,2/3,(빈칸)"이 되게 한다.
 */
const MOBILE_ROW1: readonly (SlotKey | null)[] = SLOT_ORDER.slice(0, 4);
/**
 * 모바일 2행부터 — PC와 다른 모바일 전용 순서(오너 지시, "5,8,6,7"·
 * "10,11,14,15"): 종목 선택(A·B)과 시점을 먼저 묶고, A 관련 수익률·가격,
 * 그다음 환율·B 관련을 묶는다. PC는 위 SLOT_ORDER의 원래 순서를 그대로 쓴다.
 */
const MOBILE_REST: readonly SlotKey[] = [
  "bondA", "bondB", "buyDate", "sellDate",
  "aYield", "sellYield", "buyPriceA", "sellPriceA",
  "fxRate", "bYield", "exitFxRate", "buyPriceB",
];

export function TrustStrategyPanel({ bonds, fx, state, onChange }: Props) {
  const sorted = useMemo(
    () => [...bonds].sort((a, b) => a.maturityDate.localeCompare(b.maturityDate)),
    [bonds]
  );
  const set =
    <K extends keyof SimulationState>(key: K) =>
    (v: SimulationState[K]) =>
      onChange((prev) => ({ ...prev, [key]: v }));

  /**
   * 보유종목(A) 기본값 = 2029년 만기물(오너 지정, 2026-09-17). 최단물(27년)은
   * 만기가 곧이라 중도매도 후 갈아탈 구간이 거의 없어 비교가 무의미하다.
   * 2029물이 없으면 그다음으로 만기가 이른 종목.
   */
  const defaultBondA = useMemo(
    () =>
      sorted.find((b) => b.maturityDate.startsWith("2029")) ??
      sorted.find((b) => b.maturityDate >= "2029") ??
      sorted[0],
    [sorted]
  );
  const bondA =
    sorted.find((b) => b.maturityDate === state.aKey) ?? defaultBondA;
  const bondB =
    sorted.find((b) => b.maturityDate === state.bKey) ??
    sorted.find((b) => bondA && b.maturityDate > bondA.maturityDate);

  const contractDate = state.buyDate || toISODate(today());
  const principalKrw = num(state.principalKrw);
  /**
   * 시세 환율은 소수 2자리로 끊어 쓴다.
   *
   * 칸을 비워두면 시세를 쓰는데, 화면에는 자리값으로 2자리(265.80)를 보여주면서
   * 계산에는 원값(265.8038…)을 넣고 있었다. 현금흐름 탭은 자동입력된 2자리 값을
   * 쓰므로 같은 조건인데도 만기보유 금액이 429원 어긋났다(2026-09-17 오너 지적).
   * 보이는 값과 계산하는 값이 달라서는 안 된다.
   */
  const liveFx = fx?.krwBrl != null ? Math.round(fx.krwBrl * 100) / 100 : null;
  const fxRate = state.fxRate !== "" ? num(state.fxRate) : (liveFx ?? 0);
  /** 매도시 환율 — 비우면 매수시점과 같게 본다(환율이 안 움직인 경우) */
  const exitFxRate = state.exitFxRate !== "" ? num(state.exitFxRate) : fxRate;

  /** 단가(R$)를 직접 넣었으면 그 단가를 내는 수익률로 역산해 엔진에 넣는다 */
  const yieldFromPrice = (
    settleFrom: string,
    maturityDate: string | undefined,
    price: string
  ): number | null => {
    const p = num(price, NaN);
    if (!Number.isFinite(p) || p <= 0 || !maturityDate) return null;
    const settle = getSettlementDate(settleFrom);
    const mat = parseIsoDate(maturityDate);
    if (!settle || !mat) return null;
    const y = impliedYieldFromBrazilPrice(
      settle,
      mat,
      NTNF_COUPON_PCT / 100,
      p,
      NTNF_FACE,
      NTNF_FREQUENCY
    );
    return y == null ? null : y * 100;
  };

  const aYieldEff = useMemo(() => {
    const fromPrice = yieldFromPrice(contractDate, bondA?.maturityDate, state.buyPriceA);
    if (fromPrice != null) return fromPrice;
    if (state.aYield !== "") return num(state.aYield, NaN);
    return bondA?.buyYieldPct ?? NaN;
     
  }, [contractDate, bondA?.maturityDate, state.buyPriceA, state.aYield, bondA?.buyYieldPct]);

  /**
   * B 매수가격의 기준일 — 갈아타기면 중도매도 시점, 아니면 롤오버 시점(A 만기).
   * 두 전략이 B를 사는 날이 달라 한 칸으로는 둘 다 못 맞춘다. 중도매도 시점을
   * 넣었으면 갈아타기를 보고 있다고 보고 그쪽에 맞춘다.
   */
  const bBuyFrom = state.sellDate || bondA?.maturityDate || contractDate;

  const bYieldEff = useMemo(() => {
    const fromPrice = yieldFromPrice(bBuyFrom, bondB?.maturityDate, state.buyPriceB);
    if (fromPrice != null) return fromPrice;
    if (state.bYield !== "") return num(state.bYield, NaN);
    return bondB?.buyYieldPct ?? NaN;
     
  }, [bBuyFrom, bondB?.maturityDate, state.buyPriceB, state.bYield, bondB?.buyYieldPct]);

  const sellYieldEff = useMemo(() => {
    const fromPrice = yieldFromPrice(state.sellDate, bondA?.maturityDate, state.sellPriceA);
    if (fromPrice != null) return fromPrice;
    if (state.sellYield !== "") return num(state.sellYield, NaN);
    return aYieldEff;
     
  }, [state.sellDate, bondA?.maturityDate, state.sellPriceA, state.sellYield, aYieldEff]);

  const input: TrustSimInput | null = useMemo(() => {
    if (!bondA || !(principalKrw > 0) || !(fxRate > 0)) return null;
    if (!Number.isFinite(aYieldEff)) return null;
    return {
      principalKrw,
      contractDate,
      bondA: { maturityDate: bondA.maturityDate, purchaseYieldPct: aYieldEff },
      bondB:
        bondB && Number.isFinite(bYieldEff)
          ? { maturityDate: bondB.maturityDate, purchaseYieldPct: bYieldEff }
          : undefined,
      frontFeePct: num(state.trustFee),
      // 롤오버는 같은 신탁이 이어지는 것이라 선취보수를 다시 떼지 않는다(0%)
      rolloverFrontFeePct: 0,
      // 갈아타기 선취보수는 원본과 같이 「신탁보수 선취」를 그대로 쓴다
      switchFrontFeePct: num(state.trustFee),
      backFeePct: num(state.backFee),
      // 신탁 보유현금에는 이자를 붙이지 않는다(0%)
      cashInterestPct: 0,
      comprehensiveTaxPct: COMPREHENSIVE_TAX_PCT,
      taxStatus: NTNF_TAX_STATUS,
      // 원본과 같이 단일환율 — 매수시점과 만기예상을 같게 본다
      purchaseFxRate: fxRate,
      maturityFxRate: fxRate,
      couponRatePct: NTNF_COUPON_PCT,
      couponFrequency: NTNF_FREQUENCY,
      calcBasis: NTNF_BASIS,
      exitDate: state.sellDate || undefined,
      exitSellYieldPct: Number.isFinite(sellYieldEff) ? sellYieldEff : undefined,
      exitFxRate: exitFxRate > 0 ? exitFxRate : fxRate,
    };
  }, [
    bondA, bondB, principalKrw, contractDate, fxRate,
    aYieldEff, bYieldEff, sellYieldEff, exitFxRate,
    state.trustFee, state.backFee,
    state.sellDate,
  ]);

  const hold = useMemo(() => (input ? simulateHold(input) : null), [input]);
  const roll = useMemo(() => (input ? simulateRollover(input) : null), [input]);
  const swi = useMemo(() => (input ? simulateSwitch(input) : null), [input]);
  const term = useMemo(
    () => (input ? simulateEarlyTermination(input) : null),
    [input]
  );

  // 입력칸 자리값으로 보여줄 엔진 계산 단가
  const puBuyA = hold?.legs[0]?.pricing.dirtyPrice ?? null;
  const puSellA = swi?.legs[0]?.exitPrice ?? term?.legs[0]?.exitPrice ?? null;
  const puBuyB =
    swi?.legs[1]?.pricing.dirtyPrice ?? roll?.legs[1]?.pricing.dirtyPrice ?? null;

  /**
   * 「복리 최고」 배지 — 말 그대로 복리(연) 열에서 가장 높은 전략에 붙인다.
   * 중도해지를 빼고 뽑던 것을 고쳤다(오너 지적, 2026-09-17 — "중도해지가
   * 복리수익률이 높은데?"). 기간이 짧을수록 복리가 높게 나오기 쉽다는 한계는
   * 표 아래 설명과 「기간」 열이 짚는다.
   */
  const best = useMemo(() => {
    const cands = [
      ["hold", hold] as const,
      ["roll", roll] as const,
      ["switch", swi] as const,
      ["term", term] as const,
    ].filter(([, r]) => r?.cagrPct != null);
    if (cands.length === 0) return null;
    return cands.reduce((a, b) =>
      (a[1]!.cagrPct ?? -Infinity) >= (b[1]!.cagrPct ?? -Infinity) ? a : b
    )[0];
  }, [hold, roll, swi, term]);

  /**
   * 재투자 기준 — 쿠폰으로 같은 종목을 더 사서 좌수를 불린다.
   * 좌수 증가는 현금흐름 탭 재투자형을 그대로 따른다(오너 지시, 2026-09-17).
   * 화면에는 **롤오버·갈아타기만** 둔다(오너 지시) — 재투자 여부가 갈리는
   * 지점이 두 전략의 비교라서다. 엔진에는 만기보유·중도해지 재투자도 있다.
   */
  const reRoll = useMemo(
    () => (input ? simulateReinvestRollover(input) : null),
    [input]
  );
  const reSwi = useMemo(() => (input ? simulateReinvestSwitch(input) : null), [input]);
  /** 재투자 기준에서 총수익률이 높은 쪽 (원본 탭과 같은 「우세」 표시) */
  const reWin = useMemo(() => {
    if (!reRoll || !reSwi) return null;
    return reRoll.totalReturnPct >= reSwi.totalReturnPct ? "롤오버" : "갈아타기";
  }, [reRoll, reSwi]);

  const rollCard = useMemo(
    () => cardMetrics("rollover", "만기상환 후 롤오버", roll, fxRate, contractDate),
    [roll, fxRate, contractDate]
  );
  const switchCard = useMemo(
    () => cardMetrics("switch", "중도매도 후 갈아타기", swi, fxRate, contractDate),
    [swi, fxRate, contractDate]
  );

  const slots: Record<SlotKey, ReactNode> = {
    bondA: (
      <Field label="보유종목 (A)">
        <select
          className={box}
          value={bondA?.maturityDate ?? ""}
          onChange={(e) => {
            set("aKey")(e.target.value);
            onChange((prev) => ({
              ...prev,
              aYield: "",
              buyPriceA: "",
              sellPriceA: "",
            }));
          }}
        >
          {sorted.map((b) => (
            <option key={b.maturityDate} value={b.maturityDate}>
              {b.nameKo}
            </option>
          ))}
        </select>
      </Field>
    ),
    buyDate: (
      <Field label="최초투자시점">
        <input
          className={box}
          type="date"
          value={state.buyDate}
          max={bondA?.maturityDate}
          onChange={(e) => set("buyDate")(e.target.value)}
        />
      </Field>
    ),
    aYield: (
      <Field label="A 매수수익률 (%)">
        <input
          className={numInput}
          inputMode="decimal"
          value={state.aYield !== "" ? state.aYield : (bondA?.buyYieldPct?.toString() ?? "")}
          onFocus={focusSelect}
          onChange={(e) => set("aYield")(clean(e.target.value))}
        />
      </Field>
    ),
    buyPriceA: (
      <Field label="A 매수가격 (R$, 선택)">
        <input
          className={numInput}
          inputMode="decimal"
          placeholder={puBuyA != null ? fmtNum(puBuyA, 2) : "자동"}
          value={state.buyPriceA}
          onFocus={focusSelect}
          onChange={(e) => set("buyPriceA")(clean(e.target.value))}
        />
      </Field>
    ),
    principal: (
      <Field label="신탁투자원금 (원)">
        <input
          className={numInput}
          inputMode="numeric"
          value={groupDigits(state.principalKrw)}
          onFocus={focusSelect}
          onChange={(e) => set("principalKrw")(digitsOnly(e.target.value))}
        />
      </Field>
    ),
    sellDate: (
      <Field label="중도매도 시점">
        <input
          className={box}
          type="date"
          value={state.sellDate}
          min={state.buyDate || toISODate(today())}
          max={bondA?.maturityDate}
          onChange={(e) => set("sellDate")(e.target.value)}
        />
      </Field>
    ),
    sellYield: (
      <Field label="A 중도매도수익률 (%)">
        <input
          className={numInput}
          inputMode="decimal"
          placeholder={Number.isFinite(aYieldEff) ? fmtNum(aYieldEff, 2) : ""}
          value={state.sellYield}
          onFocus={focusSelect}
          onChange={(e) => set("sellYield")(clean(e.target.value))}
        />
      </Field>
    ),
    sellPriceA: (
      <Field label="A 매도가격 (R$, 선택)">
        <input
          className={numInput}
          inputMode="decimal"
          placeholder={puSellA != null ? fmtNum(puSellA, 2) : "자동"}
          value={state.sellPriceA}
          onFocus={focusSelect}
          onChange={(e) => set("sellPriceA")(clean(e.target.value))}
        />
      </Field>
    ),
    bondB: (
      <Field label="갈아탈 종목 (B)">
        <select
          className={box}
          value={bondB?.maturityDate ?? ""}
          onChange={(e) => {
            set("bKey")(e.target.value);
            onChange((prev) => ({ ...prev, bYield: "", buyPriceB: "" }));
          }}
        >
          {sorted.map((b) => (
            <option key={b.maturityDate} value={b.maturityDate}>
              {b.nameKo}
            </option>
          ))}
        </select>
      </Field>
    ),
    exitFxRate: (
      <Field label="매도시 헤알화환율 (원/헤알)">
        <input
          className={numInput}
          inputMode="decimal"
          placeholder={fxRate > 0 ? fmtNum(fxRate, 2) : ""}
          value={state.exitFxRate}
          onFocus={focusSelect}
          onChange={(e) => set("exitFxRate")(clean(e.target.value))}
        />
      </Field>
    ),
    bYield: (
      <Field label="B 매수수익률 (%)">
        <input
          className={numInput}
          inputMode="decimal"
          value={state.bYield !== "" ? state.bYield : (bondB?.buyYieldPct?.toString() ?? "")}
          onFocus={focusSelect}
          onChange={(e) => set("bYield")(clean(e.target.value))}
        />
      </Field>
    ),
    buyPriceB: (
      <Field label="B 매수가격 (R$, 선택)">
        <input
          className={numInput}
          inputMode="decimal"
          placeholder={puBuyB != null ? fmtNum(puBuyB, 2) : "자동"}
          value={state.buyPriceB}
          onFocus={focusSelect}
          onChange={(e) => set("buyPriceB")(clean(e.target.value))}
        />
      </Field>
    ),
    trustFee: (
      <Field label="신탁보수 선취 (%)">
        <input
          className={numInput}
          inputMode="decimal"
          value={state.trustFee}
          onFocus={focusSelect}
          onChange={(e) => set("trustFee")(clean(e.target.value))}
        />
      </Field>
    ),
    fxRate: (
      <Field label="헤알화환율 (원/헤알)">
        <input
          className={numInput}
          inputMode="decimal"
          placeholder={liveFx ? fmtNum(liveFx, 2) : ""}
          value={state.fxRate}
          onFocus={focusSelect}
          onChange={(e) => set("fxRate")(clean(e.target.value))}
        />
      </Field>
    ),
    backFee: (
      <Field label="후취 신탁보수 (%, 연)">
        <input
          className={numInput}
          inputMode="decimal"
          value={state.backFee}
          onFocus={focusSelect}
          onChange={(e) => set("backFee")(clean(e.target.value))}
        />
      </Field>
    ),
  };

  if (sorted.length === 0) return null;

  const rows: {
    key: string;
    label: string;
    note: string;
    r: TrustStrategyResult | null;
    unavailable?: string;
  }[] = [
    { key: "hold", label: "만기보유", note: "A 를 만기까지", r: hold },
    {
      key: "roll",
      label: "롤오버",
      note: "A 만기상환 → B 매수",
      r: roll,
      unavailable: !input?.bondB
        ? "갈아탈 종목(B)을 고르세요."
        : bondA && bondB && bondB.maturityDate <= bondA.maturityDate
          ? "B 만기가 A 보다 이르거나 같습니다."
          : undefined,
    },
    {
      key: "switch",
      label: "갈아타기",
      note: "A 중도매도 → B 매수",
      r: swi,
      unavailable: !state.sellDate
        ? "중도매도 시점을 입력하세요."
        : bondA && state.sellDate >= bondA.maturityDate
          ? "중도매도 시점이 A 만기 이후입니다."
          : undefined,
    },
    {
      key: "term",
      label: "중도해지",
      note: "A 중도매도로 종료",
      r: term,
      unavailable: !state.sellDate ? "중도매도 시점을 입력하세요." : undefined,
    },
  ];

  return (
    <>
      <section className="space-y-3 rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-950">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
            시뮬레이션{" "}
            <span className="text-[11px] font-normal text-zinc-400">
              (만기보유 · 롤오버 · 갈아타기 · 중도해지)
            </span>
          </h2>
          <button
            type="button"
            onClick={() => onChange(createSimulationState())}
            className="shrink-0 rounded-md border border-zinc-300 px-2.5 py-1 text-xs font-medium text-zinc-600 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-900"
          >
            초기화
          </button>
        </div>

        {/*
          입력부 전체에 옅은 배경을 깔아 결과(카드·표)와 눈으로 구분한다
          (오너 지시, 2026-09-17).
          모바일은 PC와 완전히 다른 전용 블록(오너 지시) — 1행(신탁조건 3개+
          공란)과 점선 구분은 PC와 동일하게 유지하고("1,2,3,공란 점선은 동일"),
          공란은 숨기지 않고 빈 칸으로 보여준다. 2행부터는 빈칸이 없어 위에서부터
          2개씩 순서대로 짝짓는다("1,2/3,4식").
        */}
        <div className="space-y-3 rounded-lg bg-zinc-50 p-3 dark:bg-zinc-900/50">
          <div className="sm:hidden">
            <div className="grid grid-cols-2 gap-3">
              {MOBILE_ROW1.map((k, i) => (
                <div key={k ?? `blank-${i}`}>{k ? slots[k] : null}</div>
              ))}
            </div>
            <div className="mt-3 grid grid-cols-2 gap-3 border-t border-dashed border-zinc-300 pt-3 dark:border-zinc-700">
              {MOBILE_REST.map((k) => (
                <div key={k}>{slots[k]}</div>
              ))}
            </div>
          </div>
          {/* 태블릿(sm)도 PC와 동일한 4열로 — 중간에 3열 단계를 두지 않는다(오너 지시).
              점선은 전체 16칸의 정중앙(8칸씩)을 나눈다 — 1~2행(기본조건·종목선택)
              vs 3~4행(A/B 수익률·가격·환율)(오너 지시, "점선은 중간을 구분하는거다") */}
          <div className="hidden sm:block">
            {[SLOT_ORDER.slice(0, 8), SLOT_ORDER.slice(8)].map((group, g) => (
              <div
                key={g}
                className={
                  g === 0
                    ? "grid grid-cols-4 gap-3"
                    : "grid grid-cols-4 gap-3 border-t border-dashed border-zinc-300 pt-3 dark:border-zinc-700"
                }
              >
                {group.map((k, i) => (
                  <div key={k ?? `blank-${g}-${i}`}>{k ? slots[k] : null}</div>
                ))}
              </div>
            ))}
          </div>
        </div>

        {/*
          입력에 두지 않은 고정값을 화면에 밝혀둔다(오너 지시, 2026-09-17).
          투자 한 줄 요약과 매도시 환율 적용 규칙 설명은 뺐다.
        */}
        <p className="text-[11px] leading-relaxed text-zinc-400">
          표면이율 10% · 이자지급 6개월 · Business/252 · <b>비과세</b> ·{" "}
          <b>현금성이율 0%</b> · <b>롤오버 선취보수 0%</b>
        </p>
        {!input && (
          <p className="text-[11px] text-zinc-400">
            보유종목 · 신탁투자원금 · 헤알화환율을 채우면 계산된다.
          </p>
        )}

        {/* 전략 카드 — 시뮬레이션의 핵심 화면. 원본 구성 그대로 */}
        <div className="grid gap-3 sm:grid-cols-2">
          <ScenarioCard
            m={rollCard}
            frontFeePct={0}
            win={
              !!rollCard &&
              !!switchCard &&
              rollCard.totalReturnPct >= switchCard.totalReturnPct
            }
            reason={rows.find((x) => x.key === "roll")?.unavailable}
          />
          <ScenarioCard
            m={switchCard}
            frontFeePct={num(state.trustFee)}
            win={
              !!rollCard &&
              !!switchCard &&
              switchCard.totalReturnPct > rollCard.totalReturnPct
            }
            reason={rows.find((x) => x.key === "switch")?.unavailable}
          />
        </div>

        {/*
          입력부와 전략 카드까지가 한 덩어리고, 4전략 비교표부터 따로 뗀다
          (오너 지시, 2026-09-17 — "입력부랑 전략카드는 같이",
          "4전략 비교표를 박스 구분"). 테두리 박스 자체가 구분이라 선은 따로
          두지 않고 위쪽 여백만 준다.
        */}
        <div className="mt-2 overflow-x-auto rounded-lg border border-zinc-200 p-3 dark:border-zinc-800">
          {/*
            table-fixed — 전략 열 폭은 재투자 표와 동일(30%)하게 맞춘다(오너 지시,
            두 표가 위아래로 붙어 있어 열이 어긋나면 어색하다. 노트 문구가
            줄바꿈되지 않게 30%까지 넓힘). 세후 총수령은 "원"까지 한 줄에
            들어가게 22%, 나머지 3열은 16%씩.
          */}
          <table className="w-full min-w-0 sm:min-w-[460px] table-fixed text-[10px] sm:text-xs">
            <thead>
              <tr className="border-b border-zinc-200 text-left text-zinc-500 dark:border-zinc-800">
                {/* 전략 열 — 재투자 표와 모바일 기준 열 위치별로 폭을 맞춘다(오너 지시,
                    26/26/16/16/16). 노트 문구도 이 폭에서 줄바꿈 안 됨 */}
                <th className="w-[26%] py-1.5 pr-1 sm:w-[30%] sm:pr-3 font-medium">전략</th>
                <th className="w-[26%] py-1.5 pr-1 text-right font-medium sm:w-[22%] sm:pr-3">세후 총수령</th>
                <th className="w-[16%] py-1.5 pr-1 text-right font-medium sm:pr-3">총수익률</th>
                <th className="w-[16%] py-1.5 pr-1 text-right font-medium sm:pr-3">단리(연)</th>
                <th className="w-[16%] py-1.5 text-right font-medium">복리(연)</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
              {rows.map(({ key, label, note, r, unavailable }) => (
                <tr key={key}>
                  <td className="py-2 pr-1 text-zinc-800 dark:text-zinc-200 sm:pr-3">
                    {label}
                    {best === key && (
                      <span className="ml-1.5 rounded bg-blue-50 px-1.5 py-0.5 text-[10px] font-medium text-blue-700 dark:bg-blue-950 dark:text-blue-300">
                        복리 최고
                      </span>
                    )}
                    <span className="block text-[10px] text-zinc-400">{note}</span>
                  </td>
                  {r ? (
                    <>
                      <td className="py-2 pr-1 text-right font-semibold tabular-nums text-zinc-900 dark:text-zinc-100 sm:pr-3">
                        {fmtInt(r.totalReceivedKrw)}원
                      </td>
                      <td className="py-2 pr-1 text-right tabular-nums text-zinc-600 dark:text-zinc-400 sm:pr-3">
                        {fmtNum(r.totalReturnPct, 2)}%
                      </td>
                      <td className="py-2 pr-1 text-right tabular-nums text-zinc-600 dark:text-zinc-400 sm:pr-3">
                        {r.days > 0
                          ? `${fmtNum((r.totalReturnPct * 365) / r.days, 2)}%`
                          : "-"}
                      </td>
                      <td className="py-2 text-right font-semibold tabular-nums text-zinc-900 dark:text-zinc-100">
                        {r.cagrPct == null ? "-" : `${fmtNum(r.cagrPct, 2)}%`}
                      </td>
                    </>
                  ) : (
                    <td colSpan={4} className="py-2 text-zinc-400">
                      {unavailable ?? "입력값을 확인하세요."}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* 재투자 기준 — 반기지급형과 나란히 본다 */}
        {(reRoll || reSwi) && (
          <div className="mt-2 space-y-2 overflow-x-auto rounded-lg border border-zinc-200 p-3 dark:border-zinc-800">
            <h3 className="text-xs font-semibold text-zinc-800 dark:text-zinc-100">
              재투자 기준{" "}
              <span className="text-[11px] font-normal text-zinc-400">
                (쿠폰으로 같은 종목 추가 매수 — 현금흐름 탭 재투자형과 같은 규칙)
              </span>
            </h3>
            <table className="w-full min-w-0 sm:min-w-[560px] table-fixed text-[10px] sm:text-xs">
              <thead>
                <tr className="border-b border-zinc-200 text-left text-zinc-500 dark:border-zinc-800">
                  {/* 전략 열 폭은 위 4전략 표와 모바일 기준 동일(26%, sm은 30%) */}
                  <th className="w-[26%] py-1.5 pr-1 font-medium sm:w-[30%] sm:pr-3">전략</th>
                  {/* 좌수 = 위 표의 세후총수령과 같은 폭(모바일 26%, sm 20%), 나머지
                      3열은 그것들끼리(위 표 나머지 3열과도) 동일 폭 16%/10%(오너 지시) */}
                  <th className="w-[26%] py-1.5 pr-1 font-medium sm:w-[20%] sm:pr-3">
                    좌수 (최초 → 청산직전 → 갈아탄직후 → 만기)
                  </th>
                  {/* 세후 총수령은 태블릿 이상에서만 — 모바일은 좁아서 뺀다(오너 지시) */}
                  <th className="hidden py-1.5 pr-1 text-right font-medium sm:table-cell sm:w-[20%] sm:pr-3">세후 총수령</th>
                  <th className="w-[16%] py-1.5 pr-1 text-right font-medium sm:w-[10%] sm:pr-3">총수익률</th>
                  <th className="w-[16%] py-1.5 pr-1 text-right font-medium sm:w-[10%] sm:pr-3">복리(연)</th>
                  <th className="w-[16%] py-1.5 text-right font-medium sm:w-[10%]">
                    반기지급
                    <br />
                    대비
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
                {(
                  [
                    ["롤오버", reRoll, roll],
                    ["갈아타기", reSwi, swi],
                  ] as const
                ).map(([label, r, base]) => (
                  <tr key={label}>
                    <td className="py-2 pr-1 text-zinc-800 dark:text-zinc-200 sm:pr-3">
                      {label}
                      {reWin === label && (
                        <span className="ml-1.5 rounded bg-blue-50 px-1.5 py-0.5 text-[10px] font-medium text-blue-700 dark:bg-blue-950 dark:text-blue-300">
                          우세
                        </span>
                      )}
                    </td>
                    {r ? (
                      <>
                        {/* 원본 탭과 같은 4단계 표기 — 최초 → 청산직전 → 갈아탄직후 → 만기 */}
                        <td className="py-2 pr-1 tabular-nums text-zinc-600 dark:text-zinc-400 sm:pr-3">
                          {[
                            r.legs[0]?.startUnits,
                            r.legs[0]?.endUnits,
                            r.legs[1]?.startUnits,
                            r.legs[1]?.endUnits,
                          ]
                            .filter((u): u is number => u != null)
                            .map((u) => fmtInt(u))
                            .join(" → ")}
                          좌
                        </td>
                        <td className="hidden py-2 pr-1 text-right font-semibold tabular-nums text-zinc-900 dark:text-zinc-100 sm:table-cell sm:pr-3">
                          {fmtInt(r.totalReceivedKrw)}원
                        </td>
                        <td className="py-2 pr-1 text-right tabular-nums text-zinc-600 dark:text-zinc-400 sm:pr-3">
                          {fmtNum(r.totalReturnPct, 2)}%
                        </td>
                        <td className="py-2 pr-1 text-right font-semibold tabular-nums text-zinc-900 dark:text-zinc-100 sm:pr-3">
                          {r.cagrPct == null ? "-" : `${fmtNum(r.cagrPct, 2)}%`}
                        </td>
                        {/* 원본처럼 총수익률 차이를 %p 로 (오너 지시, 2026-09-17) */}
                        <td className="py-2 text-right tabular-nums text-emerald-600 dark:text-emerald-400">
                          {base
                            ? `${pct(r.totalReturnPct - base.totalReturnPct, 2)}p`
                            : "-"}
                        </td>
                      </>
                    ) : (
                      <td colSpan={5} className="py-2 text-zinc-400">
                        입력값을 확인하세요.
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/*
          지표 설명 문단은 오너 지시로 걷어냈다(2026-09-17).
          「단리(연)」 = 총수익률 × 365 ÷ 투자일수(현금흐름 탭 「세후수익률」과 같은 기준),
          「복리 최고」 = 복리(연) 열 최고값, 이 엔진은 쿠폰을 재투자하지 않는다 —
          셋 다 CLAUDE.md 에 남겨둔다.
        */}
      </section>

      <CashFlowDisclaimer />
    </>
  );
}
