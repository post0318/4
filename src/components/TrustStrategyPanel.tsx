"use client";

import { type Dispatch, type FocusEvent, type SetStateAction, useMemo } from "react";
import { CashFlowDisclaimer } from "@/components/cashflow/CashFlowDisclaimer";
import { fmtInt, fmtNum, normalizeDecimalInput } from "@/lib/format";
import { toISODate, today } from "@/lib/ntnfPricing";
import {
  breakEvenReinvestPct,
  simulateEarlyTermination,
  simulateHold,
  simulateRollover,
  simulateSwitch,
  type TrustSimInput,
  type TrustStrategyResult,
} from "@/lib/cashflow/trustSimulation";
import type { BondLayoutInput } from "@/lib/cashflow/bondLayout";
import type { SimulationState } from "@/components/RollSwitchComparison";
import type { BondItem } from "@/lib/types";

/**
 * 시뮬레이션 탭 — **현금흐름 탭과 같은 엔진**으로 네 전략을 비교한다.
 *
 * 신탁 조건(원금·보수율·현금성이율·과세여부·세율·환율·표면이율·이자지급주기·
 * 신탁계약일)은 현금흐름 탭 입력을 그대로 가져온다. 여기서 따로 받으면 두 탭이
 * 어긋나기 때문이다(2026-09-17 결정). 이 탭에서는 전략에만 필요한 값
 * (보유종목·갈아탈 종목·각 수익률·청산 시점·청산 수수료)만 받는다.
 *
 * 정리 전 계산은 「시뮬레이션 원본」 탭에 보존돼 있다.
 */

interface Props {
  bonds: BondItem[];
  /** 현금흐름 탭 입력 — 신탁 조건의 단일 출처 */
  cashflow: BondLayoutInput;
  state: SimulationState;
  onChange: Dispatch<SetStateAction<SimulationState>>;
}

const box =
  "w-full rounded border border-zinc-300 px-2 py-1.5 text-sm outline-none focus:border-blue-400 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100";
const numInput = `${box} text-right tabular-nums`;
const focusSelect = (e: FocusEvent<HTMLInputElement>) => e.currentTarget.select();
const clean = normalizeDecimalInput;

const num = (s: string, fallback = 0) => {
  const v = parseFloat(s);
  return Number.isFinite(v) ? v : fallback;
};

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[11px] text-zinc-500 dark:text-zinc-400">
        {label}
        {hint && <span className="text-zinc-400"> {hint}</span>}
      </span>
      {children}
    </label>
  );
}

export function TrustStrategyPanel({ bonds, cashflow, state, onChange }: Props) {
  const sorted = useMemo(
    () => [...bonds].sort((a, b) => a.maturityDate.localeCompare(b.maturityDate)),
    [bonds]
  );
  const set =
    <K extends keyof SimulationState>(key: K) =>
    (v: SimulationState[K]) =>
      onChange((prev) => ({ ...prev, [key]: v }));

  const bondA = sorted.find((b) => b.maturityDate === state.aKey) ?? sorted[0];
  const bondB =
    sorted.find((b) => b.maturityDate === state.bKey) ??
    sorted.find((b) => bondA && b.maturityDate > bondA.maturityDate);

  const contractDate = cashflow.trustContractDate || toISODate(today());
  const principalKrw = num(cashflow.trustInvestmentAmount);
  const purchaseFx = num(cashflow.purchaseFxRate);
  const maturityFx = num(cashflow.maturityFxRate, purchaseFx);

  const input: TrustSimInput | null = useMemo(() => {
    if (!bondA || !(principalKrw > 0) || !(purchaseFx > 0)) return null;
    const aY = state.aYield !== "" ? num(state.aYield) : (bondA.buyYieldPct ?? NaN);
    if (!Number.isFinite(aY)) return null;
    const bY =
      state.bYield !== ""
        ? num(state.bYield)
        : (bondB?.buyYieldPct ?? NaN);
    return {
      principalKrw,
      contractDate,
      bondA: { maturityDate: bondA.maturityDate, purchaseYieldPct: aY },
      bondB:
        bondB && Number.isFinite(bY)
          ? { maturityDate: bondB.maturityDate, purchaseYieldPct: bY }
          : undefined,
      frontFeePct: num(cashflow.frontFeeRate),
      rolloverFrontFeePct: num(state.rollFee),
      switchFrontFeePct: num(state.switchFee),
      backFeePct: num(cashflow.backFeeRate),
      cashInterestPct: num(cashflow.cashInterestRate),
      comprehensiveTaxPct: num(cashflow.incomeTaxRate, 15.4),
      taxStatus: cashflow.taxStatus,
      purchaseFxRate: purchaseFx,
      maturityFxRate: maturityFx > 0 ? maturityFx : purchaseFx,
      couponRatePct: num(cashflow.couponRate, 10),
      couponFrequency: cashflow.couponFrequency,
      calcBasis: cashflow.calcBasis,
      exitDate: state.sellDate || undefined,
      exitSellYieldPct:
        state.sellYield !== "" ? num(state.sellYield) : Number.isFinite(aY) ? aY : undefined,
    };
  }, [
    bondA, bondB, principalKrw, contractDate, purchaseFx, maturityFx,
    cashflow.frontFeeRate, cashflow.backFeeRate, cashflow.cashInterestRate,
    cashflow.incomeTaxRate, cashflow.taxStatus, cashflow.couponRate,
    cashflow.couponFrequency, cashflow.calcBasis,
    state.aYield, state.bYield, state.sellDate, state.sellYield,
    state.rollFee, state.switchFee,
  ]);

  const hold = useMemo(() => (input ? simulateHold(input) : null), [input]);
  const roll = useMemo(() => (input ? simulateRollover(input) : null), [input]);
  const swi = useMemo(() => (input ? simulateSwitch(input) : null), [input]);
  const term = useMemo(
    () => (input ? simulateEarlyTermination(input) : null),
    [input]
  );
  const breakEven = useMemo(
    () => (term && hold ? breakEvenReinvestPct(term, hold) : null),
    [term, hold]
  );

  // 복리(CAGR)가 가장 높은 전략에 표시 — 종료 시점이 달라 총수익률로는 못 고른다
  const best = useMemo(() => {
    const cands = [
      ["hold", hold] as const,
      ["roll", roll] as const,
      ["switch", swi] as const,
    ].filter(([, r]) => r?.cagrPct != null);
    if (cands.length === 0) return null;
    return cands.reduce((a, b) =>
      (a[1]!.cagrPct ?? -Infinity) >= (b[1]!.cagrPct ?? -Infinity) ? a : b
    )[0];
  }, [hold, roll, swi]);

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
      note: "A 중도청산 → B 매수",
      r: swi,
      unavailable: !state.sellDate
        ? "중도청산 시점을 입력하세요."
        : bondA && state.sellDate >= bondA.maturityDate
          ? "청산 시점이 A 만기 이후입니다."
          : undefined,
    },
    {
      key: "term",
      label: "중도해지",
      note: "A 중도청산으로 종료",
      r: term,
      unavailable: !state.sellDate ? "중도청산 시점을 입력하세요." : undefined,
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
        </div>

        <p className="text-[11px] leading-relaxed text-zinc-400">
          현금흐름 탭과 같은 엔진으로 계산한다 — 후취보수·현금성이자·세금·환율·
          경과이자의 원금 차감이 그대로 반영된다. 원금 {fmtInt(principalKrw)}원 ·
          선취 {fmtNum(num(cashflow.frontFeeRate), 2)}% · 후취{" "}
          {fmtNum(num(cashflow.backFeeRate), 2)}% · 현금성{" "}
          {fmtNum(num(cashflow.cashInterestRate), 2)}% · {cashflow.taxStatus} ·
          환율 매수 {fmtNum(purchaseFx, 2)} / 만기 {fmtNum(maturityFx, 2)} ·
          계약일 {contractDate} 은 <b>현금흐름 탭 설정</b>을 따른다.
        </p>

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Field label="보유종목 (A)">
            <select
              className={box}
              value={bondA?.maturityDate ?? ""}
              onChange={(e) => set("aKey")(e.target.value)}
            >
              {sorted.map((b) => (
                <option key={b.maturityDate} value={b.maturityDate}>
                  {b.nameKo}
                </option>
              ))}
            </select>
          </Field>
          <Field label="A 매수수익률 (%)" hint="비우면 시세">
            <input
              className={numInput}
              inputMode="decimal"
              placeholder={bondA?.buyYieldPct != null ? fmtNum(bondA.buyYieldPct, 2) : "자동"}
              value={state.aYield}
              onFocus={focusSelect}
              onChange={(e) => set("aYield")(clean(e.target.value))}
            />
          </Field>
          <Field label="갈아탈 종목 (B)">
            <select
              className={box}
              value={bondB?.maturityDate ?? ""}
              onChange={(e) => set("bKey")(e.target.value)}
            >
              <option value="">선택 안 함</option>
              {sorted.map((b) => (
                <option key={b.maturityDate} value={b.maturityDate}>
                  {b.nameKo}
                </option>
              ))}
            </select>
          </Field>
          <Field label="B 매수수익률 (%)" hint="비우면 시세">
            <input
              className={numInput}
              inputMode="decimal"
              placeholder={bondB?.buyYieldPct != null ? fmtNum(bondB.buyYieldPct, 2) : "자동"}
              value={state.bYield}
              onFocus={focusSelect}
              onChange={(e) => set("bYield")(clean(e.target.value))}
            />
          </Field>
          <Field label="중도청산 시점" hint="갈아타기·중도해지">
            <input
              className={box}
              type="date"
              value={state.sellDate}
              max={bondA?.maturityDate}
              onChange={(e) => set("sellDate")(e.target.value)}
            />
          </Field>
          <Field label="A 매도수익률 (%)" hint="비우면 매수와 동일">
            <input
              className={numInput}
              inputMode="decimal"
              placeholder={state.aYield || (bondA?.buyYieldPct != null ? fmtNum(bondA.buyYieldPct, 2) : "자동")}
              value={state.sellYield}
              onFocus={focusSelect}
              onChange={(e) => set("sellYield")(clean(e.target.value))}
            />
          </Field>
          <Field label="롤오버 선취보수 (%)">
            <input
              className={numInput}
              inputMode="decimal"
              value={state.rollFee}
              onFocus={focusSelect}
              onChange={(e) => set("rollFee")(clean(e.target.value))}
            />
          </Field>
          <Field label="갈아타기 선취보수 (%)">
            <input
              className={numInput}
              inputMode="decimal"
              value={state.switchFee}
              onFocus={focusSelect}
              onChange={(e) => set("switchFee")(clean(e.target.value))}
            />
          </Field>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-xs">
            <thead>
              <tr className="border-b border-zinc-200 text-left text-zinc-500 dark:border-zinc-800">
                <th className="py-1.5 pr-3 font-medium">전략</th>
                <th className="py-1.5 pr-3 font-medium">종료</th>
                <th className="py-1.5 pr-3 text-right font-medium">세후 총수령</th>
                <th className="py-1.5 pr-3 text-right font-medium">총수익률</th>
                <th className="py-1.5 pr-3 text-right font-medium">복리(연)</th>
                <th className="py-1.5 text-right font-medium">기간</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
              {rows.map(({ key, label, note, r, unavailable }) => (
                <tr key={key}>
                  <td className="py-2 pr-3 text-zinc-800 dark:text-zinc-200">
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
                      <td className="py-2 pr-3 tabular-nums text-zinc-500">{r.endDate}</td>
                      <td className="py-2 pr-3 text-right font-semibold tabular-nums text-zinc-900 dark:text-zinc-100">
                        {fmtInt(r.totalReceivedKrw)}원
                      </td>
                      <td className="py-2 pr-3 text-right tabular-nums text-zinc-600 dark:text-zinc-400">
                        {fmtNum(r.totalReturnPct, 2)}%
                      </td>
                      <td className="py-2 pr-3 text-right font-semibold tabular-nums text-zinc-900 dark:text-zinc-100">
                        {r.cagrPct == null ? "-" : `${fmtNum(r.cagrPct, 2)}%`}
                      </td>
                      <td className="py-2 text-right tabular-nums text-zinc-500">
                        {fmtInt(r.days)}일
                      </td>
                    </>
                  ) : (
                    <td colSpan={5} className="py-2 text-zinc-400">
                      {unavailable ?? "입력값을 확인하세요."}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {term && hold && breakEven != null && (
          <p className="rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2 text-xs leading-relaxed text-zinc-600 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-300">
            <b>중도해지 판단</b> — {term.endDate} 에 해지하면 {fmtInt(term.totalReceivedKrw)}
            원을 받습니다. 그 돈을 남은 {fmtInt(hold.days - term.days)}일 동안 연{" "}
            <b>{fmtNum(breakEven, 2)}%</b> 넘게 굴릴 수 있어야 만기까지 보유하는
            것보다 낫습니다.
          </p>
        )}

        <p className="text-[11px] leading-relaxed text-zinc-400">
          종료 시점이 전략마다 달라 총수익률로는 우열을 가릴 수 없다 — 「복리(연)」로
          견준다. 이 엔진은 반기지급형이라 <b>쿠폰을 재투자하지 않는다</b>. 받은
          쿠폰을 다시 굴리면 일찍 옮겨 탄 쪽(갈아타기)이 유리해질 수 있다.
        </p>

        {rows.some((x) => x.r && x.r.legs.length > 1) && (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-[11px]">
              <thead>
                <tr className="border-b border-zinc-200 text-left text-zinc-500 dark:border-zinc-800">
                  <th className="py-1.5 pr-3 font-medium">구간 내역</th>
                  <th className="py-1.5 pr-3 font-medium">종목 · 기간</th>
                  <th className="py-1.5 pr-3 text-right font-medium">투입 원금</th>
                  <th className="py-1.5 text-right font-medium">회수</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
                {rows
                  .filter((x) => x.r && x.r.legs.length > 1)
                  .flatMap(({ label, r }) =>
                    r!.legs.map((l, i) => (
                      <tr key={`${label}-${i}`}>
                        <td className="py-1.5 pr-3 text-zinc-500">
                          {i === 0 ? label : ""}
                        </td>
                        <td className="py-1.5 pr-3 text-zinc-600 dark:text-zinc-400">
                          {l.bondMaturity} · {l.contractDate} → {l.endDate}
                          {l.exitPrice != null && (
                            <span className="text-zinc-400">
                              {" "}
                              (청산 R${fmtNum(l.exitPrice, 2)})
                            </span>
                          )}
                        </td>
                        <td className="py-1.5 pr-3 text-right tabular-nums">
                          {fmtInt(l.principalKrw)}원
                        </td>
                        <td className="py-1.5 text-right tabular-nums">
                          {fmtInt(l.recoveredKrw)}원
                        </td>
                      </tr>
                    ))
                  )}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <CashFlowDisclaimer />
    </>
  );
}
