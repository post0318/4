"use client";

import { useMemo, useState } from "react";
import { fmtNum } from "@/lib/format";
import { bondRisk, shockReturn } from "@/lib/ntnfDuration";
import type { BondItem } from "@/lib/types";

interface Props {
  bonds: BondItem[];
}

function signColor(v: number) {
  return v > 0
    ? "text-emerald-600 dark:text-emerald-400"
    : v < 0
      ? "text-red-600 dark:text-red-400"
      : "text-zinc-500 dark:text-zinc-400";
}

function pct(v: number, d = 2) {
  return `${v >= 0 ? "+" : ""}${fmtNum(v, d)}%`;
}

export function DurationPanel({ bonds }: Props) {
  const [dy, setDy] = useState(1); // 금리변동 %p
  const [dfx, setDfx] = useState(0); // 환율변동 %

  const sorted = useMemo(
    () => [...bonds].sort((a, b) => a.maturityDate.localeCompare(b.maturityDate)),
    [bonds]
  );

  const rows = useMemo(
    () =>
      sorted.map((b) => {
        const risk =
          b.buyYieldPct != null ? bondRisk(b.maturityDate, b.buyYieldPct) : null;
        const shock = risk ? shockReturn(risk, dy, dfx) : null;
        return { bond: b, risk, shock };
      }),
    [sorted, dy, dfx]
  );

  if (sorted.length === 0) {
    return (
      <section className="rounded-xl border border-zinc-200 bg-white p-4 text-sm text-zinc-500 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-400">
        종목을 불러오는 중입니다.
      </section>
    );
  }

  const th =
    "px-2 py-2 text-right font-semibold text-zinc-500 dark:text-zinc-400 whitespace-nowrap";
  const td = "px-2 py-2 text-right whitespace-nowrap tabular-nums";

  return (
    <section className="space-y-4 rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-950">
      <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
        듀레이션 · 금리/환율 민감도
      </h2>

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <div className="mb-1 flex items-baseline justify-between text-xs">
            <span className="text-zinc-500 dark:text-zinc-400">금리변동</span>
            <span className="font-semibold tabular-nums text-zinc-800 dark:text-zinc-100">
              {dy >= 0 ? "+" : ""}
              {fmtNum(dy, 2)} %p
            </span>
          </div>
          <input
            type="range"
            min={-3}
            max={3}
            step={0.25}
            value={dy}
            onChange={(e) => setDy(parseFloat(e.target.value))}
            className="w-full"
          />
        </div>
        <div>
          <div className="mb-1 flex items-baseline justify-between text-xs">
            <span className="text-zinc-500 dark:text-zinc-400">
              환율변동 (헤알/원)
            </span>
            <span className="font-semibold tabular-nums text-zinc-800 dark:text-zinc-100">
              {dfx >= 0 ? "+" : ""}
              {fmtNum(dfx, 1)} %
            </span>
          </div>
          <input
            type="range"
            min={-20}
            max={20}
            step={1}
            value={dfx}
            onChange={(e) => setDfx(parseFloat(e.target.value))}
            className="w-full"
          />
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-xs">
          <thead>
            <tr className="border-b border-zinc-200 dark:border-zinc-800">
              <th className={`${th} text-left`}>종목</th>
              <th className={th}>매수수익률</th>
              <th className={th}>PU (R$)</th>
              <th className={th}>수정듀레이션</th>
              <th className={th}>DV01</th>
              <th className={th}>가격변동</th>
              <th className={th}>환율변동</th>
              <th className={th}>원화가치변동</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ bond, risk, shock }) => (
              <tr
                key={bond.maturityDate}
                className="border-b border-zinc-100 dark:border-zinc-900"
              >
                <td className={`${td} text-left`}>
                  <span className="font-medium text-zinc-800 dark:text-zinc-100">
                    {bond.nameKo}
                  </span>
                  <span className="ml-1 text-zinc-400">{bond.maturityDate}</span>
                </td>
                <td className={td}>
                  {bond.buyYieldPct != null
                    ? `${fmtNum(bond.buyYieldPct, 2)}%`
                    : "-"}
                </td>
                <td className={td}>{risk ? fmtNum(risk.pu, 2) : "-"}</td>
                <td className={`${td} font-semibold`}>
                  {risk ? `${fmtNum(risk.modDuration, 2)}년` : "-"}
                </td>
                <td className={td}>{risk ? fmtNum(risk.dv01, 3) : "-"}</td>
                <td className={`${td} ${shock ? signColor(shock.pricePct) : ""}`}>
                  {shock ? pct(shock.pricePct) : "-"}
                </td>
                <td className={`${td} ${shock ? signColor(shock.fxPct) : ""}`}>
                  {shock ? pct(shock.fxPct, 1) : "-"}
                </td>
                <td
                  className={`${td} font-semibold ${
                    shock ? signColor(shock.krwPct) : ""
                  }`}
                >
                  {shock ? pct(shock.krwPct) : "-"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="text-[11px] text-zinc-400">
        수정듀레이션 D*는 수익률 100bp 변화 시 대략적인 PU 변화율(년)입니다. 가격변동
        ≈ −D*·Δy + ½·컨벡시티·Δy², 원화가치변동 = (1+가격변동)(1+환율변동)−1. 결제일
        D+0, NTN-F(액면 R$1,000). 근사치입니다.
      </p>
    </section>
  );
}
