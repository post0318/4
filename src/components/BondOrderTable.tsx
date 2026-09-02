"use client";

import {
  digitsOnly,
  fmtInt,
  fmtNum,
  groupDecimal,
  groupDigits,
  truncDecimals,
} from "@/lib/format";
import type { OrderResult } from "@/lib/quantity";
import type { BondItem } from "@/lib/types";

export interface BondRow {
  key: string;
  bond: BondItem;
  checked: boolean;
  krwInput: string;
  /** 달러($) 칸 표시/편집값 (자동 산출값 또는 사용자 수정값) */
  usdInput: string;
  /** 달러($)가 자동값에서 수정됨 */
  usdEdited: boolean;
  pu: number | null;
  /** 달러 환전액 기준 매수가능수량·1좌당 가격 등 */
  order: OrderResult | null;
  /** 실제 주문수량 입력값 (빈 값이면 매수가능수량으로 간주) */
  orderQtyInput: string;
  /** 실제 주문수량 (정수 좌, 0이면 없음) */
  effectiveQty: number;
  /** 주문수량이 매수가능수량을 초과 */
  orderQtyExceeds: boolean;
}

interface BondOrderTableProps {
  rows: BondRow[];
  asOfDate: string | null;
  loading: boolean;
  error: string | null;
  fxReady: boolean;
  settlementDate: string;
  /** 환전금액의 원화금액 (0이면 미입력) — 원화투자금액 합계와의 차이 표시용 */
  exchangeKrwTotal: number;
  /** 환전금액의 달러금액 (0이면 미입력) — 달러($) 합계와의 차이 표시용 */
  exchangeUsdTotal: number;
  onToggle: (key: string) => void;
  onAmountChange: (key: string, value: string) => void;
  onUsdChange: (key: string, value: string) => void;
  onOrderQtyChange: (key: string, value: string) => void;
}

/** 달러 입력값 정규화: 숫자·소수점 1개, 소수 2자리까지만 */
function sanitizeUsd(value: string): string {
  const cleaned = value.replace(/[^\d.]/g, "");
  const firstDot = cleaned.indexOf(".");
  if (firstDot === -1) return cleaned;
  const frac = cleaned
    .slice(firstDot + 1)
    .replace(/\./g, "")
    .slice(0, 2);
  return `${cleaned.slice(0, firstDot + 1)}${frac}`;
}

/**
 * 브라질국채(NTN-F) 전 종목을 표로 표시한다 (요구사항 2·3).
 * 각 행: [체크박스] 종목명·ISIN·만기·매수수익률 + (체크 시) 원화투자금액 입력 →
 * 달러($, 자동이나 수정 가능)·PU·1좌당 매수가격·매수가능수량을 산출하고,
 * 실제 주문수량(기본값 = 매수가능수량)을 그 이하로 조정한다.
 * 체크된 종목만 활성화되고 이메일 발송 대상이 된다.
 */
export function BondOrderTable({
  rows,
  asOfDate,
  loading,
  error,
  fxReady,
  settlementDate,
  exchangeKrwTotal,
  exchangeUsdTotal,
  onToggle,
  onAmountChange,
  onUsdChange,
  onOrderQtyChange,
}: BondOrderTableProps) {
  const th =
    "px-2 py-2 text-left font-semibold text-zinc-500 dark:text-zinc-400 whitespace-nowrap";
  const td = "px-2 py-2 whitespace-nowrap tabular-nums";
  const numInput =
    "rounded border px-1 py-1 text-right tabular-nums outline-none focus:border-blue-400 disabled:cursor-not-allowed disabled:bg-zinc-50 disabled:text-zinc-300 dark:bg-zinc-950 dark:text-zinc-100 dark:disabled:bg-zinc-900";

  const checkedRows = rows.filter((r) => r.checked);
  const totalKrw = checkedRows.reduce(
    (s, r) => s + (parseInt(r.krwInput || "0", 10) || 0),
    0
  );
  const totalUsd = checkedRows.reduce(
    (s, r) => s + (parseFloat(r.usdInput || "0") || 0),
    0
  );
  const krwDiff = totalKrw - exchangeKrwTotal;
  const usdDiff = truncDecimals(totalUsd - exchangeUsdTotal, 2);

  return (
    <section className="rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-950">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
          종목 · 매수가능수량 <span className="text-zinc-400">({rows.length}개)</span>
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
                <th className={th}>매수수익률</th>
                <th className={`${th} text-right`}>원화투자금액</th>
                <th className={`${th} text-right`}>달러($)</th>
                <th className={`${th} text-right`}>PU (R$)</th>
                <th className={`${th} text-right`}>1좌당 매수가격(₩)</th>
                <th className={`${th} text-right`}>종목별 매수가능수량</th>
                <th className={`${th} text-right`}>실제주문수량</th>
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
                          onAmountChange(row.key, digitsOnly(e.target.value))
                        }
                        maxLength={14}
                        placeholder={row.checked ? "예: 10,000,000" : ""}
                        className={`w-[6rem] border-zinc-300 dark:border-zinc-700 ${numInput}`}
                      />
                    </td>
                    <td className={`${td} text-right`}>
                      <input
                        inputMode="decimal"
                        value={row.usdInput}
                        disabled={!row.checked}
                        onChange={(e) =>
                          onUsdChange(row.key, sanitizeUsd(e.target.value))
                        }
                        maxLength={14}
                        title={row.usdEdited ? "자동값에서 수정됨" : "원화투자금액 ÷ 환율 자동값 (수정 가능)"}
                        className={`w-[6rem] ${numInput} ${
                          row.usdEdited
                            ? "border-blue-400 font-semibold text-blue-700 dark:text-blue-300"
                            : "border-zinc-300 dark:border-zinc-700"
                        }`}
                      />
                    </td>
                    <td className={`${td} ${dim} text-right`}>
                      {row.pu !== null ? fmtNum(row.pu, 4) : "-"}
                    </td>
                    <td className={`${td} ${dim} text-right`}>
                      {order ? `₩ ${fmtInt(order.krwPerUnit)}` : "-"}
                    </td>
                    <td className={`${td} ${dim} text-right`}>
                      {order ? `${fmtInt(order.quantity)} 좌` : "-"}
                    </td>
                    <td className={`${td} text-right`}>
                      <input
                        inputMode="numeric"
                        value={order ? groupDigits(row.orderQtyInput) : ""}
                        disabled={!row.checked || !order}
                        onChange={(e) =>
                          onOrderQtyChange(row.key, digitsOnly(e.target.value))
                        }
                        maxLength={9}
                        aria-invalid={row.orderQtyExceeds}
                        className={`w-[4.5rem] font-bold disabled:font-normal ${numInput} ${
                          row.orderQtyExceeds
                            ? "border-red-400 text-red-600 dark:text-red-400"
                            : "border-zinc-300 text-blue-700 dark:border-zinc-700 dark:text-blue-300"
                        }`}
                      />
                    </td>
                  </tr>
                );
              })}
              {rows.length === 0 && (
                <tr>
                  <td className="px-2 py-4 text-center text-zinc-400" colSpan={11}>
                    거래 중인 종목이 없습니다.
                  </td>
                </tr>
              )}
            </tbody>
            {(checkedRows.length > 0 || exchangeKrwTotal > 0) && (
              <tfoot>
                <tr className="border-t-2 border-zinc-300 font-semibold dark:border-zinc-700">
                  <td className={`${td} text-right`} colSpan={5}>
                    원화투자금액 합계
                  </td>
                  <td className={`${td} text-right`}>
                    {totalKrw > 0 ? groupDigits(String(totalKrw)) : "-"}
                  </td>
                  <td className={`${td} text-right`}>
                    {totalUsd > 0 ? fmtNum(totalUsd, 2) : "-"}
                  </td>
                  <td className={td} colSpan={4} />
                </tr>
                {exchangeKrwTotal > 0 && (
                  <tr
                    className={
                      krwDiff === 0
                        ? "text-zinc-500 dark:text-zinc-400"
                        : "font-semibold text-red-600 dark:text-red-400"
                    }
                  >
                    <td className={`${td} text-right`} colSpan={5}>
                      환전금액 원화금액({groupDigits(String(exchangeKrwTotal))})과의 차이
                    </td>
                    <td className={`${td} text-right`}>
                      {krwDiff === 0
                        ? "0"
                        : (krwDiff > 0 ? "+" : "") +
                          groupDecimal(String(krwDiff))}
                    </td>
                    <td className={td} colSpan={5} />
                  </tr>
                )}
                {exchangeUsdTotal > 0 && (
                  <tr
                    className={
                      usdDiff === 0
                        ? "text-zinc-500 dark:text-zinc-400"
                        : "font-semibold text-red-600 dark:text-red-400"
                    }
                  >
                    <td className={`${td} text-right`} colSpan={5}>
                      환전금액 달러금액(${fmtNum(exchangeUsdTotal, 2)})과의 차이
                    </td>
                    <td className={`${td} text-right`}>
                      {usdDiff === 0
                        ? "0"
                        : (usdDiff > 0 ? "+" : "−") +
                          fmtNum(Math.abs(usdDiff), 2)}
                    </td>
                    <td className={td} colSpan={5} />
                  </tr>
                )}
              </tfoot>
            )}
          </table>
        </div>
      )}

      {!fxReady && !loading && (
        <p className="mt-2 text-[11px] text-amber-600 dark:text-amber-400">
          환율을 불러오면 달러환전액·매수가능수량이 계산됩니다.
        </p>
      )}
      <p className="mt-2 text-[11px] text-zinc-400">
        체크한 종목만 원화투자금액 입력·수량 산출·이메일 발송 대상이 됩니다.
        원화투자금액 합계는 위 환전금액의 원화금액과 같아야 발송할 수 있습니다.
        달러($)는 환전금액의 달러금액을 원화투자금액 비중대로 나눠(2자리 절사,
        잔동은 최대 종목 가산) 채운 자동값이며 직접 수정할 수 있고, 환전금액이
        비어 있으면 원화투자금액 ÷ 환율로 채웁니다. 매수가능수량은 달러 환전액
        기준 헤알 환산액 ÷ PU 정수 절사(1좌 = 액면 R$1,000)입니다. 실제주문수량은
        기본값이 매수가능수량이며 그 이하로 조정합니다.
      </p>
    </section>
  );
}
