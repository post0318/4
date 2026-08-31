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

/**
 * 헤알 강세(+)는 따뜻한 모래빛, 약세(−)는 차분한 청회색으로 은은하게 구분한다.
 * (원색 빨강/파랑 대신 채도를 낮춰 눈이 편하도록)
 */
function fxRowBg(shift: number): string | undefined {
  if (shift === 0) return undefined;
  const a = (Math.min(15, Math.abs(shift)) / 15) * 0.17 + 0.05; // 0.05~0.22
  return shift > 0
    ? `rgba(193, 126, 86, ${a.toFixed(3)})` // 소프트 테라코타 (강세)
    : `rgba(96, 122, 150, ${a.toFixed(3)})`; // 차분한 슬레이트블루 (약세)
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
    "px-1.5 py-1.5 text-center font-semibold text-zinc-600 dark:text-zinc-300 leading-tight border border-zinc-200 dark:border-zinc-800 bg-zinc-100 dark:bg-zinc-800/60";
  const cell =
    "px-1.5 py-1.5 text-right tabular-nums border border-zinc-200 dark:border-zinc-800";

  const colW = `${(100 / (2 + bonds.length * 2)).toFixed(3)}%`;

  return (
    <div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[560px] table-fixed border-collapse text-[13px]">
          <colgroup>
            <col style={{ width: colW }} />
            <col style={{ width: colW }} />
            {bonds.flatMap((b) => [
              <col key={`${b.label}-a`} style={{ width: colW }} />,
              <col key={`${b.label}-t`} style={{ width: colW }} />,
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
                    const total =
                      ((1 + b.hold.totalPct / 100) * (1 + fxCum) - 1) * 100;
                    // 단리 연환산 (총수익률 ÷ 잔존연수) — 일반형·재투자형 동일,
                    // 현금흐름 탭과 같은 방식
                    const annual = total / b.hold.years;
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
      <p className="mt-1 text-xs text-zinc-400">
        총누적수익률 = 잔존기간 전체 수익률. 헤알화 강세(＋)는 따뜻한 색,
        약세(−)는 차분한 색으로 표시.
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
  const [reinvest, setReinvest] = useState(false); // 쿠폰 재투자형

  // 잔존만기 1년 미만은 듀레이션·시나리오 의미가 없어 제외
  const cutoff = useMemo(() => {
    const d = new Date();
    d.setFullYear(d.getFullYear() + 1);
    return d.toISOString().slice(0, 10);
  }, []);
  const sorted = useMemo(
    () =>
      [...bonds]
        .filter((b) => b.maturityDate >= cutoff)
        .sort((a, b) => a.maturityDate.localeCompare(b.maturityDate)),
    [bonds, cutoff]
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
  // reinvest=false 일반형(쿠폰 현금수령) / true 재투자형(쿠폰을 매수금리로 복리 재투자)
  const matrixBonds: MatrixBond[] = useMemo(
    () =>
      sorted.map((b) => ({
        label: `NTN-F ${b.maturityDate.slice(0, 4)}`,
        hold:
          b.buyYieldPct != null
            ? holdToMaturityBrl(b.maturityDate, b.buyYieldPct, 0, reinvest)
            : null,
      })),
    [sorted, reinvest]
  );

  if (sorted.length === 0) {
    return (
      <section className="rounded-xl border border-zinc-200 bg-white p-4 text-sm text-zinc-500 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-400">
        종목을 불러오는 중입니다.
      </section>
    );
  }

  const th =
    "px-2 py-2 font-semibold text-zinc-500 dark:text-zinc-400 leading-tight";
  const td = "px-2 py-1.5 whitespace-nowrap tabular-nums";

  return (
    <div className="space-y-4">
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
        <table className="w-full min-w-[560px] table-fixed border-collapse text-[13px]">
          <colgroup>
            <col className="w-[19%]" />
            {/* 수익률 ~ 원화가치변동: 7칸 동일폭 */}
            {Array.from({ length: 7 }, (_, i) => (
              <col key={i} className="w-[11.57%]" />
            ))}
          </colgroup>
          <thead>
            <tr className="border-b border-zinc-200 bg-zinc-100 dark:border-zinc-800 dark:bg-zinc-800/60">
              <th className={`${th} text-center`}>종목</th>
              <th className={`${th} text-center`}>수익률</th>
              <th className={`${th} text-center`}>PU</th>
              <th className={`${th} text-center`}>수정
                <br />듀레이션</th>
              <th className={`${th} text-center`}>수익률 0.01%p
                <br />가격변화(R$)</th>
              <th className={`${th} text-center`}>가격
                <br />변동</th>
              <th className={`${th} text-center`}>환율
                <br />변동</th>
              <th className={`${th} text-center`}>원화가치
                <br />변동</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ bond, risk, shock }, i) => (
              <tr
                key={bond.maturityDate}
                className={`border-b border-zinc-100 dark:border-zinc-900 ${
                  i % 2 === 1 ? "bg-zinc-50/70 dark:bg-zinc-900/40" : ""
                }`}
              >
                <td className={`${td} text-left`}>
                  <span className="font-medium text-zinc-800 dark:text-zinc-100">
                    {bond.nameKo}
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

      <p className="text-xs text-zinc-400">
        수정듀레이션 D*는 수익률 100bp 변화 시 대략적인 PU 변화율(년)입니다.
        「수익률 0.01%p 가격변화」는 수익률이 0.01%p 오를 때 PU(액면 R$1,000)가
        떨어지는 금액입니다. 가격변동 ≈ −D*·Δy + ½·컨벡시티·Δy², 원화가치변동 =
        (1+가격변동)(1+환율변동)−1. 결제일 D+0, NTN-F(액면 R$1,000). 근사치입니다.
      </p>
    </section>

    <section className="space-y-3 rounded-xl border border-zinc-300 bg-zinc-50/60 p-3 dark:border-zinc-700 dark:bg-zinc-900/40">
      <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
          환율 시나리오별 예상 수익률
        </h2>
        <label className="flex items-center gap-1.5 text-xs text-zinc-600 dark:text-zinc-300">
          <input
            type="checkbox"
            checked={reinvest}
            onChange={(e) => setReinvest(e.target.checked)}
            className="h-3.5 w-3.5"
          />
          재투자형
        </label>
      </div>
      <p className="text-xs text-zinc-400">
        현재 가격으로 매입해 만기까지 보유를 가정 → 금리변동에 따른 평가손익 없음
        (금리 손익은 위 가격변동 표 참고).
      </p>
      {fx?.krwBrl ? (
        <ReturnMatrix bonds={matrixBonds} baseFx={fx.krwBrl} />
      ) : (
        <p className="text-xs text-zinc-400">환율을 불러오면 표시됩니다.</p>
      )}
      <p className="text-xs text-zinc-400">
        세전 · 단리 연환산(총수익률 ÷ 잔존연수, 현금흐름 탭과 동일) · 수수료·세금
        미반영.{" "}
        {reinvest
          ? "재투자형: 쿠폰을 매수금리로 재투자한다고 가정."
          : "일반형: 쿠폰을 현금으로 받아 재투자하지 않음(현금이자 0)."}
      </p>
    </section>
    </div>
  );
}
