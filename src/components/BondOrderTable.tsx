"use client";

import { fmtInt, fmtNum, groupDigits } from "@/lib/format";
import type { OrderResult } from "@/lib/quantity";
import type { BondItem } from "@/lib/types";

export interface BondRow {
  key: string;
  bond: BondItem;
  checked: boolean;
  krwInput: string;
  pu: number | null;
  order: OrderResult | null;
}

interface BondOrderTableProps {
  rows: BondRow[];
  asOfDate: string | null;
  loading: boolean;
  error: string | null;
  fxReady: boolean;
  settlementDate: string;
  onToggle: (key: string) => void;
  onAmountChange: (key: string, value: string) => void;
}

/**
 * 브라질국채(NTN-F) 전 종목을 표로 표시한다 (요구사항 2·3).
 * 각 행: [체크박스] 종목명·ISIN·만기·표면이율·매수수익률 + (체크 시) 원화투자금액
 * 입력 → 달러환전액·PU·매수수량·실매수금액을 같은 행의 열로 산출.
 * 체크된 종목만 활성화되고 이메일 발송 대상이 된다.
 */
export function BondOrderTable({
  rows,
  asOfDate,
  loading,
  error,
  fxReady,
  settlementDate,
  onToggle,
  onAmountChange,
}: BondOrderTableProps) {
  const th =
    "px-2 py-2 text-left font-semibold text-zinc-500 dark:text-zinc-400 whitespace-nowrap";
  const td = "px-2 py-2 whitespace-nowrap tabular-nums";

  return (
    <section className="rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-950">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
          종목 · 매수수량 <span className="text-zinc-400">({rows.length}개)</span>
        </h2>
        <span className="text-[11px] text-zinc-400">
          {asOfDate ? `시세 기준일 ${asOfDate} · 결제일 ${settlementDate}` : ""}
        </span>
      </div>

      {loading && (
        <p className="text-xs text-zinc-500 dark:text-zinc-400">불러오는 중…</p>
      )}
      {error && <p className="text-xs text-red-500">{error}</p>}

      {!loading && !error && (
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-xs">
            <thead>
              <tr className="border-b border-zinc-200 dark:border-zinc-800">
                <th className={th}>선택</th>
                <th className={th}>종목명</th>
                <th className={th}>ISIN</th>
                <th className={th}>만기일</th>
                <th className={th}>표면이율</th>
                <th className={th}>매수수익률</th>
                <th className={`${th} text-right`}>원화투자금액</th>
                <th className={`${th} text-right`}>달러($)</th>
                <th className={`${th} text-right`}>PU (R$)</th>
                <th className={`${th} text-right`}>매수수량</th>
                <th className={`${th} text-right`}>실매수금액(₩)</th>
                <th className={`${th} text-right`}>잔여(₩)</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const { bond, order } = row;
                const dim = row.checked ? "" : "text-zinc-400 dark:text-zinc-600";
                return (
                  <tr
                    key={row.key}
                    className={`border-b border-zinc-100 dark:border-zinc-900 ${
                      row.checked ? "bg-blue-50/50 dark:bg-blue-950/20" : ""
                    }`}
                  >
                    <td className={td}>
                      <input
                        type="checkbox"
                        checked={row.checked}
                        onChange={() => onToggle(row.key)}
                        className="h-4 w-4 align-middle"
                        aria-label={`${bond.nameKo} 선택`}
                      />
                    </td>
                    <td className={`${td} ${dim}`}>
                      <span className="font-medium">{bond.nameKo}</span>
                      {bond.isin && !bond.isinVerified && (
                        <span className="ml-1 rounded bg-amber-100 px-1 text-[10px] font-medium text-amber-700 dark:bg-amber-900/40 dark:text-amber-300">
                          확인 필요
                        </span>
                      )}
                    </td>
                    <td className={`${td} ${dim}`}>{bond.isin ?? "-"}</td>
                    <td className={`${td} ${dim}`}>{bond.maturityDate}</td>
                    <td className={`${td} ${dim} text-right`}>
                      연 {fmtNum(bond.couponRatePct, 2)}%
                    </td>
                    <td className={`${td} ${dim} text-right`}>
                      {bond.buyYieldPct !== null
                        ? `연 ${fmtNum(bond.buyYieldPct, 2)}%`
                        : "-"}
                    </td>
                    <td className={`${td} text-right`}>
                      <input
                        inputMode="numeric"
                        value={groupDigits(row.krwInput)}
                        disabled={!row.checked}
                        onChange={(e) =>
                          onAmountChange(
                            row.key,
                            e.target.value.replace(/[^\d]/g, "")
                          )
                        }
                        maxLength={14}
                        placeholder={row.checked ? "예: 10,000,000" : ""}
                        className="w-[7rem] rounded border border-zinc-300 px-1.5 py-1 text-right tabular-nums outline-none focus:border-blue-400 disabled:cursor-not-allowed disabled:bg-zinc-50 disabled:text-zinc-300 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100 dark:disabled:bg-zinc-900"
                      />
                    </td>
                    <td className={`${td} ${dim} text-right`}>
                      {order ? `$ ${fmtNum(order.usdAmount, 2)}` : "-"}
                    </td>
                    <td className={`${td} ${dim} text-right`}>
                      {row.pu !== null ? fmtNum(row.pu, 4) : "-"}
                    </td>
                    <td
                      className={`${td} text-right ${
                        row.checked && order
                          ? "font-bold text-blue-700 dark:text-blue-300"
                          : dim
                      }`}
                    >
                      {order ? `${fmtInt(order.quantity)} 좌` : "-"}
                    </td>
                    <td className={`${td} ${dim} text-right`}>
                      {order ? `₩ ${fmtInt(order.krwCost)}` : "-"}
                    </td>
                    <td className={`${td} ${dim} text-right`}>
                      {order ? `₩ ${fmtInt(order.krwLeftover)}` : "-"}
                    </td>
                  </tr>
                );
              })}
              {rows.length === 0 && (
                <tr>
                  <td className="px-2 py-4 text-center text-zinc-400" colSpan={12}>
                    거래 중인 종목이 없습니다.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {!fxReady && !loading && (
        <p className="mt-2 text-[11px] text-amber-600 dark:text-amber-400">
          환율을 불러오면 달러환전액·매수수량이 계산됩니다.
        </p>
      )}
      <p className="mt-2 text-[11px] text-zinc-400">
        체크한 종목만 원화투자금액 입력·수량 산출·이메일 발송 대상이 됩니다. 매수수량은
        헤알 환산액 ÷ PU 정수 절사(1좌 = 액면 R$1,000).
      </p>
    </section>
  );
}
