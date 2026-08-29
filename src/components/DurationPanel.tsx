"use client";

import { useMemo, useState } from "react";
import { fmtNum } from "@/lib/format";
import { bondRisk, shockReturn } from "@/lib/ntnfDuration";
import { holdToMaturityBrl } from "@/lib/ntnfSimulation";
import type { BondItem, FxRates } from "@/lib/types";

interface Props {
  bonds: BondItem[];
  fx: FxRates | null;
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

// 환율 시나리오: 원화 대비 헤알화 강세(+) ~ 약세(−)
const FX_SHIFTS = [15, 10, 5, 0, -5, -10, -15];

/** 헤알 강세(+)면 붉게, 약세(−)면 푸르게 */
function fxRowBg(shift: number): string | undefined {
  const a = (Math.min(15, Math.abs(shift)) / 15) * 0.42;
  if (shift > 0) return `rgba(239,68,68,${a})`;
  if (shift < 0) return `rgba(59,130,246,${a})`;
  return undefined;
}

interface MatrixBond {
  label: string;
  /** 만기까지 보유 시 헤알 연환산·누적 수익률(%), 잔존연수 */
  hold: { annualPct: number; totalPct: number; years: number } | null;
}

/**
 * 환율 시나리오(행) × 종목(열) 예상 원화수익률 요약표.
 * 각 셀: 현재 매수금리로 지금 매수해 만기까지 보유했을 때의 원화 연환산·누적 수익률
 * (행의 환율변동 결합). 만기 보유이므로 금리변동에 따른 평가손익은 없다 —
 * 금리변동 손익은 위쪽 "가격변동" 표(중도 매도 기준)를 참고.
 */
function ReturnMatrix({
  bonds,
  baseFx,
}: {
  bonds: MatrixBond[];
  baseFx: number;
}) {
  const th =
    "px-1 py-1 text-center font-semibold text-zinc-600 dark:text-zinc-300 leading-tight border border-zinc-200 dark:border-zinc-800";
  const cell =
    "px-1 py-1 text-right tabular-nums border border-zinc-200 dark:border-zinc-800";

  return (
    <div>
      <p className="mb-1 text-[12px] text-zinc-500 dark:text-zinc-400">
        환율 시나리오별 예상 원화수익률 — 현재 매수금리로 지금 매수해 만기까지 보유
        (만기 보유라 금리변동 평가손익 없음)
      </p>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[760px] table-fixed border-collapse text-[12px]">
          <colgroup>
            <col className="w-[7.14%]" />
            <col className="w-[7.14%]" />
            {bonds.flatMap((b) => [
              <col key={`${b.label}-a`} className="w-[7.14%]" />,
              <col key={`${b.label}-t`} className="w-[7.14%]" />,
            ])}
          </colgroup>
          <thead>
            <tr>
              <th className={th} rowSpan={2}>
                헤알화
                <br />
                강·약세
              </th>
              <th className={th} rowSpan={2}>
                원/헤알
              </th>
              {bonds.map((b) => (
                <th className={th} colSpan={2} key={b.label}>
                  {b.label}
                </th>
              ))}
            </tr>
            <tr>
              {bonds.map((b) => (
                <FragmentCols key={b.label} th={th} />
              ))}
            </tr>
          </thead>
          <tbody>
            {FX_SHIFTS.map((shift) => {
              const bg = fxRowBg(shift);
              const fxRate = baseFx * (1 + shift / 100);
              return (
                <tr key={shift} style={bg ? { background: bg } : undefined}>
                  <td
                    className={`${cell} text-center ${
                      shift === 0 ? "font-bold" : ""
                    }`}
                  >
                    {shift > 0 ? "+" : ""}
                    {shift}%
                  </td>
                  <td className={`${cell} ${shift === 0 ? "font-bold" : ""}`}>
                    {fmtNum(fxRate, 2)}
                  </td>
                  {bonds.map((b) => {
                    if (!b.hold)
                      return (
                        <FragmentDash key={b.label} cell={cell} />
                      );
                    const fxCum = shift / 100;
                    const annual =
                      ((1 + b.hold.annualPct / 100) *
                        Math.pow(1 + fxCum, 1 / b.hold.years) -
                        1) *
                      100;
                    const total =
                      ((1 + b.hold.totalPct / 100) * (1 + fxCum) - 1) * 100;
                    const bold = shift === 0 ? "font-bold" : "";
                    return (
                      <FragmentVals
                        key={b.label}
                        cell={cell}
                        bold={bold}
                        annual={annual}
                        total={total}
                      />
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="mt-1 text-[11px] text-zinc-400">
        총누적수익률 = 잔존기간 전체 수익률, 연환산수익률 = 이를 연 단위로 환산.
        헤알화 강세(＋)일수록 붉게.
      </p>
    </div>
  );
}

function FragmentCols({ th }: { th: string }) {
  return (
    <>
      <th className={th}>
        연환산
        <br />
        수익률
      </th>
      <th className={th}>
        총누적
        <br />
        수익률
      </th>
    </>
  );
}
function FragmentDash({ cell }: { cell: string }) {
  return (
    <>
      <td className={cell}>-</td>
      <td className={cell}>-</td>
    </>
  );
}
function FragmentVals({
  cell,
  bold,
  annual,
  total,
}: {
  cell: string;
  bold: string;
  annual: number;
  total: number;
}) {
  return (
    <>
      <td className={`${cell} ${bold}`}>{fmtNum(annual, 2)}%</td>
      <td className={`${cell} ${bold} text-zinc-500 dark:text-zinc-400`}>
        {fmtNum(total, 2)}%
      </td>
    </>
  );
}

export function DurationPanel({ bonds, fx }: Props) {
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

  // 요약표: 종목별 "현재 매수금리로 만기까지 보유 시 헤알 수익률" (금리 Δ 무관)
  const matrixBonds: MatrixBond[] = useMemo(
    () =>
      sorted.map((b) => ({
        label: `NTN-F ${b.maturityDate.slice(0, 4)}`,
        hold:
          b.buyYieldPct != null
            ? holdToMaturityBrl(b.maturityDate, b.buyYieldPct, 0)
            : null,
      })),
    [sorted]
  );

  if (sorted.length === 0) {
    return (
      <section className="rounded-xl border border-zinc-200 bg-white p-4 text-sm text-zinc-500 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-400">
        종목을 불러오는 중입니다.
      </section>
    );
  }

  const th =
    "px-1.5 py-1.5 font-semibold text-zinc-500 dark:text-zinc-400 leading-tight";
  const td = "px-1.5 py-1 whitespace-nowrap tabular-nums";

  return (
    <section className="space-y-3 rounded-xl border border-zinc-200 bg-white p-3 dark:border-zinc-800 dark:bg-zinc-950">
      <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
        금리/환율 민감도
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
        <table className="w-full min-w-[640px] table-fixed border-collapse text-xs">
          <colgroup>
            <col className="w-[16%]" />
            {/* 수익률 ~ 원화가치변동: 7칸 동일폭 */}
            {Array.from({ length: 7 }, (_, i) => (
              <col key={i} className="w-[12%]" />
            ))}
          </colgroup>
          <thead>
            <tr className="border-b border-zinc-200 dark:border-zinc-800">
              <th className={`${th} text-left`}>종목</th>
              <th className={`${th} text-right`}>수익률</th>
              <th className={`${th} text-right`}>PU</th>
              <th className={`${th} text-right`}>수정
                <br />듀레이션</th>
              <th className={`${th} text-right`}>DV01</th>
              <th className={`${th} text-right`}>가격
                <br />변동</th>
              <th className={`${th} text-right`}>환율
                <br />변동</th>
              <th className={`${th} text-right`}>원화가치
                <br />변동</th>
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
                  <span className="ml-1 text-zinc-400">
                    {bond.maturityDate.slice(0, 4)}
                  </span>
                </td>
                <td className={`${td} text-right`}>
                  {bond.buyYieldPct != null
                    ? `${fmtNum(bond.buyYieldPct, 2)}%`
                    : "-"}
                </td>
                <td className={`${td} text-right`}>
                  {risk ? fmtNum(risk.pu, 2) : "-"}
                </td>
                <td className={`${td} text-right font-semibold`}>
                  {risk ? `${fmtNum(risk.modDuration, 2)}년` : "-"}
                </td>
                <td className={`${td} text-right`}>
                  {risk ? fmtNum(risk.dv01, 3) : "-"}
                </td>
                <td
                  className={`${td} text-right ${
                    shock ? signColor(shock.pricePct) : ""
                  }`}
                >
                  {shock ? pct(shock.pricePct) : "-"}
                </td>
                <td
                  className={`${td} text-right ${
                    shock ? signColor(shock.fxPct) : ""
                  }`}
                >
                  {shock ? pct(shock.fxPct, 1) : "-"}
                </td>
                <td
                  className={`${td} text-right font-semibold ${
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

      {fx?.krwBrl ? (
        <ReturnMatrix bonds={matrixBonds} baseFx={fx.krwBrl} />
      ) : (
        <p className="text-[11px] text-zinc-400">
          환율을 불러오면 예상수익률 요약표가 표시됩니다.
        </p>
      )}

      <p className="text-[11px] text-zinc-400">
        수정듀레이션 D*는 수익률 100bp 변화 시 대략적인 PU 변화율(년)입니다. 가격변동
        ≈ −D*·Δy + ½·컨벡시티·Δy², 원화가치변동 = (1+가격변동)(1+환율변동)−1. 결제일
        D+0, NTN-F(액면 R$1,000). 근사치입니다.
      </p>
    </section>
  );
}
