import { MonthlyCashFlowRow } from "@/lib/cashflow/monthlyCashFlow";
import { CashFlowDisclaimer } from "@/components/cashflow/CashFlowDisclaimer";

interface MonthlyCashFlowTableProps {
  rows: MonthlyCashFlowRow[] | null;
  custodyCurrency: string;
  error?: string | null;
}

const HEAD_ROWS = 6;
const TAIL_ROWS = 6;

function fmt(n: number, isKrw: boolean): string {
  if (isKrw) return Math.trunc(n).toLocaleString("ko-KR");
  const t = Math.trunc(n * 100) / 100;
  return t.toLocaleString("ko-KR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

/** 차감(음수)은 회계 관행대로 괄호로 표시: -815,983 → (815,983) */
function fmtParen(n: number, isKrw: boolean): string {
  if (!n) return "";
  return n < 0 ? `(${fmt(-n, isKrw)})` : fmt(n, isKrw);
}

export function MonthlyCashFlowTable({
  rows,
  custodyCurrency,
  error,
}: MonthlyCashFlowTableProps) {
  const data = rows ?? [];
  const isKrw = custodyCurrency === "KRW";

  const columns = [
    "지급일",
    "원금",
    "보유현금",
    "채권이자",
    "현금이자",
    "과세소득",
    "과세표준",
    "소득세",
    "세후수령액",
  ];

  const cols = (
    <colgroup>
      {columns.map((c) => (
        <col key={c} style={{ width: `${(100 / columns.length).toFixed(3)}%` }} />
      ))}
    </colgroup>
  );

  const total = data.reduce(
    (a, r) => ({
      payout: a.payout + r.payout,
      // 원금 합계는 월지급분만 (만기상환 원금수령분은 제외)
      principalDelta:
        a.principalDelta + (r.type === "만기상환" ? 0 : r.principalDelta),
      bondInterest: a.bondInterest + r.bondInterest,
      cashInterest: a.cashInterest + r.cashInterest,
      taxableIncome: a.taxableIncome + r.taxableIncome,
      incomeTax: a.incomeTax + r.incomeTax,
      netAmount: a.netAmount + r.netAmount,
    }),
    {
      payout: 0,
      principalDelta: 0,
      bondInterest: 0,
      cashInterest: 0,
      taxableIncome: 0,
      incomeTax: 0,
      netAmount: 0,
    }
  );

  const isTruncated = data.length > HEAD_ROWS + TAIL_ROWS;
  const omitted = data.length - HEAD_ROWS - TAIL_ROWS;

  const cell = "py-2 pr-2 text-right tabular-nums";
  const renderRow = (row: MonthlyCashFlowRow) => (
    <tr
      key={`${row.date}-${row.type}`}
      className={`border-b border-zinc-100 last:border-0 dark:border-zinc-900 ${
        row.type === "만기상환"
          ? "bg-amber-100/70 dark:bg-amber-950/30"
          : row.bondInterest
            ? "bg-orange-50 dark:bg-orange-950/20"
            : ""
      }`}
    >
      <td className="py-2 pr-2 text-zinc-700 dark:text-zinc-300">
        {row.date}
      </td>
      <td
        className={`${cell} ${
          row.principalDelta < 0
            ? "text-red-600 dark:text-red-400"
            : "text-zinc-700 dark:text-zinc-300"
        }`}
      >
        {fmtParen(row.principalDelta, isKrw)}
      </td>
      <td className={`${cell} text-zinc-700 dark:text-zinc-300`}>
        {row.cashBalance ? fmt(row.cashBalance, isKrw) : ""}
      </td>
      <td className={`${cell} text-zinc-700 dark:text-zinc-300`}>
        {row.bondInterest ? fmt(row.bondInterest, isKrw) : ""}
      </td>
      <td className={`${cell} text-zinc-700 dark:text-zinc-300`}>
        {row.cashInterest ? fmt(row.cashInterest, isKrw) : ""}
      </td>
      <td className={`${cell} text-zinc-700 dark:text-zinc-300`}>
        {row.taxableIncome ? fmt(row.taxableIncome, isKrw) : ""}
      </td>
      <td className={`${cell} text-zinc-700 dark:text-zinc-300`}>
        {row.taxBase ? fmt(row.taxBase, isKrw) : ""}
      </td>
      <td className={`${cell} text-zinc-700 dark:text-zinc-300`}>
        {row.incomeTax ? fmt(row.incomeTax, isKrw) : ""}
      </td>
      <td className="py-2 text-right tabular-nums font-medium text-zinc-900 dark:text-zinc-100">
        {fmt(row.netAmount, isKrw)}
      </td>
    </tr>
  );

  const head = (
    <thead>
      <tr className="border-b border-zinc-200 bg-zinc-100 text-left text-zinc-500 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-400">
        {columns.map((c, i) => (
          <th
            key={c}
            className={`py-2 pr-2 font-medium ${
              i > 0 ? "text-right" : ""
            }`}
          >
            {c}
          </th>
        ))}
      </tr>
    </thead>
  );

  const foot = (
    <tfoot>
      <tr className="border-t border-zinc-200 bg-orange-50 font-semibold text-zinc-900 dark:border-zinc-800 dark:bg-orange-950/30 dark:text-zinc-100">
        <td className="py-2 pr-2">합 계</td>
        <td className={cell}>{fmtParen(total.principalDelta, isKrw)}</td>
        <td className="py-2 pr-2" />
        <td className={cell}>{fmt(total.bondInterest, isKrw)}</td>
        <td className={cell}>{fmt(total.cashInterest, isKrw)}</td>
        <td className={cell}>{fmt(total.taxableIncome, isKrw)}</td>
        <td className="py-2 pr-2" />
        <td className={cell}>{fmt(total.incomeTax, isKrw)}</td>
        <td className="py-2 text-right tabular-nums">
          {fmt(total.netAmount, isKrw)}
        </td>
      </tr>
    </tfoot>
  );

  return (
    <section className="rounded-2xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-950 sm:p-6 print:p-2">
      <h2 className="mb-5 print:mb-1 text-base font-semibold text-zinc-900 dark:text-zinc-100">
        현금흐름표{" "}
        <span className="text-xs font-normal text-zinc-400">(월지급식)</span>
      </h2>

      {error && (
        <p className="mb-4 rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-sm font-medium text-red-700 dark:border-red-800 dark:bg-red-950/30 dark:text-red-300">
          ⚠ {error}
        </p>
      )}

      {data.length === 0 ? (
        <p className="text-sm text-zinc-500 dark:text-zinc-400">
          채권정보와 신탁계약일, 신탁투자금액, 유보율, 보수율을 모두 입력하면
          월지급 현금흐름표가 표시됩니다.
        </p>
      ) : (
        <>
          {/* 화면: 전체 행 */}
          <div className="overflow-x-auto print:hidden">
            <table className="w-full min-w-[860px] table-fixed text-sm">
              {cols}
              {head}
              <tbody>{data.map(renderRow)}</tbody>
              {foot}
            </table>
          </div>

          {/* 인쇄: 앞/뒤 일부만, 중간 생략 */}
          <div className="hidden overflow-x-auto print:block">
            <table className="w-full min-w-[860px] table-fixed text-sm">
              {cols}
              {head}
              <tbody>
                {(isTruncated ? data.slice(0, HEAD_ROWS) : data).map(renderRow)}
                {isTruncated && (
                  <tr>
                    <td
                      colSpan={columns.length}
                      className="py-2 text-center text-xs text-zinc-400 dark:text-zinc-600"
                    >
                      ⋮ 중간 {omitted.toLocaleString("ko-KR")}건 생략 ⋮
                    </td>
                  </tr>
                )}
                {isTruncated &&
                  data.slice(data.length - TAIL_ROWS).map(renderRow)}
              </tbody>
              {foot}
            </table>
          </div>
        </>
      )}

      <CashFlowDisclaimer />
    </section>
  );
}
