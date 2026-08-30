import { CashFlowRow } from "@/lib/cashflow/cashFlowSchedule";
import { CashFlowDisclaimer } from "@/components/cashflow/CashFlowDisclaimer";

interface CashFlowTableProps {
  rows: CashFlowRow[] | null;
  custodyCurrency: string;
}

const HEAD_ROWS = 5;
const TAIL_ROWS = 5;
const MAX_VISIBLE_ROWS = HEAD_ROWS + TAIL_ROWS;

function formatAmount(n: number, isKrw: boolean): string {
  if (isKrw) {
    return Math.trunc(n).toLocaleString("ko-KR");
  }
  const truncated = Math.trunc(n * 100) / 100;
  return truncated.toLocaleString("ko-KR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

/** 차감(음수)은 회계 관행대로 괄호로 표시: -815,983 → (815,983) */
function formatParen(n: number, isKrw: boolean): string {
  if (!n) return "";
  return n < 0 ? `(${formatAmount(-n, isKrw)})` : formatAmount(n, isKrw);
}

export function CashFlowTable({ rows, custodyCurrency }: CashFlowTableProps) {
  const data = rows ?? [];
  const isKrw = custodyCurrency === "KRW";

  const columns = [
    "이자계산일",
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
    (acc, row) => ({
      // 원금 합계는 경과이자 차감분만 (만기 원금상환액은 제외) — 월지급식과 동일
      principal: acc.principal + (row.principalReturn ?? 0),
      interest: acc.interest + row.interest,
      cashInterest: acc.cashInterest + row.cashInterest,
      taxableIncome: acc.taxableIncome + row.taxableIncome,
      incomeTax: acc.incomeTax + row.incomeTax,
      // 만기 회차는 원금상환·반환현금 포함한 실지급액으로 합산
      netAmount: acc.netAmount + (row.maturityPayout ?? row.netAmount),
    }),
    {
      principal: 0,
      interest: 0,
      cashInterest: 0,
      taxableIncome: 0,
      incomeTax: 0,
      netAmount: 0,
    }
  );

  const isTruncated = data.length > MAX_VISIBLE_ROWS;
  const headRows = isTruncated ? data.slice(0, HEAD_ROWS) : data;
  const tailRows = isTruncated ? data.slice(data.length - TAIL_ROWS) : [];
  const omittedCount = data.length - headRows.length - tailRows.length;

  const renderRow = (row: CashFlowRow) => (
    <tr
      key={row.date}
      className="border-b border-zinc-100 last:border-0 dark:border-zinc-900"
    >
      <td className="py-2 pr-2 text-zinc-700 dark:text-zinc-300">
        {row.date}
      </td>
      <td
        className={`py-2 pr-2 text-right tabular-nums ${
          row.principalReturn && row.principalReturn < 0
            ? "text-red-600 dark:text-red-400"
            : "text-zinc-700 dark:text-zinc-300"
        }`}
      >
        {row.principalReturn
          ? formatParen(row.principalReturn, isKrw)
          : row.principal
            ? formatAmount(row.principal, isKrw)
            : ""}
      </td>
      <td className="py-2 pr-2 text-right tabular-nums text-zinc-700 dark:text-zinc-300">
        {formatAmount(row.cashBalance, isKrw)}
      </td>
      <td className="py-2 pr-2 text-right tabular-nums text-zinc-700 dark:text-zinc-300">
        {formatAmount(row.interest, isKrw)}
      </td>
      <td className="py-2 pr-2 text-right tabular-nums text-zinc-700 dark:text-zinc-300">
        {row.cashInterest ? formatAmount(row.cashInterest, isKrw) : ""}
      </td>
      <td className="py-2 pr-2 text-right tabular-nums text-zinc-700 dark:text-zinc-300">
        {formatAmount(row.taxableIncome, isKrw)}
      </td>
      <td className="py-2 pr-2 text-right tabular-nums text-zinc-700 dark:text-zinc-300">
        {formatAmount(row.taxBase, isKrw)}
      </td>
      <td className="py-2 pr-2 text-right tabular-nums text-zinc-700 dark:text-zinc-300">
        {formatAmount(row.incomeTax, isKrw)}
      </td>
      <td className="py-2 text-right tabular-nums font-medium text-zinc-900 dark:text-zinc-100">
        {formatAmount(row.maturityPayout ?? row.netAmount, isKrw)}
      </td>
    </tr>
  );

  return (
    <section className="rounded-2xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-950 sm:p-6 print:p-2">
      <h2 className="mb-5 print:mb-1 text-base font-semibold text-zinc-900 dark:text-zinc-100">
        현금흐름표{" "}
        <span className="text-xs font-normal text-zinc-400">(반기지급식)</span>
      </h2>

      {data.length === 0 ? (
        <p className="text-sm text-zinc-500 dark:text-zinc-400">
          채권정보와 신탁계약일, 신탁투자금액, 선취/후취보수율을 모두
          입력하면 현금흐름표가 표시됩니다.
        </p>
      ) : (
        <>
          {/* 화면: 전체 행 표시 */}
          <div className="overflow-x-auto print:hidden">
            <table className="w-full min-w-[860px] table-fixed text-sm">
              {cols}
              <thead>
                <tr className="border-b border-zinc-200 bg-zinc-100 text-left text-zinc-500 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-400">
                  {columns.map((col, i) => (
                    <th
                      key={col}
                      className={`py-2 pr-2 font-medium leading-tight ${
                        i > 0 ? "text-right" : ""
                      }`}
                    >
                      {col}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>{data.map(renderRow)}</tbody>
              <tfoot>
                <tr className="border-t border-zinc-200 bg-orange-50 dark:border-zinc-800 dark:bg-orange-950/30">
                  <td className="py-2 pr-2 font-semibold text-zinc-900 dark:text-zinc-100">
                    합 계
                  </td>
                  <td className="py-2 pr-2 text-right tabular-nums font-semibold text-zinc-900 dark:text-zinc-100">
                    {formatParen(total.principal, isKrw)}
                  </td>
                  <td className="py-2 pr-4" />
                  <td className="py-2 pr-2 text-right tabular-nums font-semibold text-zinc-900 dark:text-zinc-100">
                    {formatAmount(total.interest, isKrw)}
                  </td>
                  <td className="py-2 pr-2 text-right tabular-nums font-semibold text-zinc-900 dark:text-zinc-100">
                    {formatAmount(total.cashInterest, isKrw)}
                  </td>
                  <td className="py-2 pr-2 text-right tabular-nums font-semibold text-zinc-900 dark:text-zinc-100">
                    {formatAmount(total.taxableIncome, isKrw)}
                  </td>
                  <td className="py-2 pr-4" />
                  <td className="py-2 pr-2 text-right tabular-nums font-semibold text-zinc-900 dark:text-zinc-100">
                    {formatAmount(total.incomeTax, isKrw)}
                  </td>
                  <td className="py-2 text-right tabular-nums font-semibold text-zinc-900 dark:text-zinc-100">
                    {formatAmount(total.netAmount, isKrw)}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>

          {/* 인쇄: 앞/뒤 일부만 표시하고 중간은 생략 */}
          <div className="hidden overflow-x-auto print:block">
            <table className="w-full min-w-[860px] table-fixed text-sm">
              {cols}
              <thead>
                <tr className="border-b border-zinc-200 bg-zinc-100 text-left text-zinc-500 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-400">
                  {columns.map((col, i) => (
                    <th
                      key={col}
                      className={`py-2 pr-2 font-medium leading-tight ${
                        i > 0 ? "text-right" : ""
                      }`}
                    >
                      {col}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {headRows.map(renderRow)}
                {isTruncated && (
                  <tr className="border-b border-zinc-100 dark:border-zinc-900">
                    <td
                      colSpan={columns.length}
                      className="py-2 text-center text-xs text-zinc-400 dark:text-zinc-600"
                    >
                      ⋮ 중간 {omittedCount.toLocaleString("ko-KR")}건 생략 ⋮
                    </td>
                  </tr>
                )}
                {tailRows.map(renderRow)}
              </tbody>
              <tfoot>
                <tr className="border-t border-zinc-200 bg-orange-50 dark:border-zinc-800 dark:bg-orange-950/30">
                  <td className="py-2 pr-2 font-semibold text-zinc-900 dark:text-zinc-100">
                    합 계
                  </td>
                  <td className="py-2 pr-2 text-right tabular-nums font-semibold text-zinc-900 dark:text-zinc-100">
                    {formatParen(total.principal, isKrw)}
                  </td>
                  <td className="py-2 pr-4" />
                  <td className="py-2 pr-2 text-right tabular-nums font-semibold text-zinc-900 dark:text-zinc-100">
                    {formatAmount(total.interest, isKrw)}
                  </td>
                  <td className="py-2 pr-2 text-right tabular-nums font-semibold text-zinc-900 dark:text-zinc-100">
                    {formatAmount(total.cashInterest, isKrw)}
                  </td>
                  <td className="py-2 pr-2 text-right tabular-nums font-semibold text-zinc-900 dark:text-zinc-100">
                    {formatAmount(total.taxableIncome, isKrw)}
                  </td>
                  <td className="py-2 pr-4" />
                  <td className="py-2 pr-2 text-right tabular-nums font-semibold text-zinc-900 dark:text-zinc-100">
                    {formatAmount(total.incomeTax, isKrw)}
                  </td>
                  <td className="py-2 text-right tabular-nums font-semibold text-zinc-900 dark:text-zinc-100">
                    {formatAmount(total.netAmount, isKrw)}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        </>
      )}

      <p className="hidden print:block text-xs">&nbsp;</p>

      <CashFlowDisclaimer />
    </section>
  );
}
