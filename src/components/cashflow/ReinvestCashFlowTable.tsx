import { Fragment } from "react";
import { ReinvestCashFlowRow } from "@/lib/cashflow/reinvestCashFlow";

interface Props {
  rows: ReinvestCashFlowRow[] | null;
}

const HEAD_ROWS = 6;
const TAIL_ROWS = 6;

function brl(n: number): string {
  if (!n) return "";
  return (Math.trunc(n * 100) / 100).toLocaleString("ko-KR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}
function krw(n: number): string {
  if (!n) return "";
  return Math.trunc(n).toLocaleString("ko-KR");
}
function units(n: number): string {
  if (!n) return "";
  return Math.round(n).toLocaleString("ko-KR");
}

/**
 * 재투자형 현금흐름 — 회차별 [보유좌수 · 이자(R$) · 재매수단가 · 매수좌수 ·
 * 누적좌수 · 잔여현금(R$)], 만기 회차는 원화 회수액.
 */
export function ReinvestCashFlowTable({ rows }: Props) {
  const data = rows ?? [];

  const columns = [
    "이자계산일",
    "전기보유좌수",
    "이자(R$)",
    "재매수단가",
    "매수좌수",
    "당기보유좌수",
    "잔여현금(R$)",
    "만기회수액(₩)",
  ];

  const isTruncated = data.length > HEAD_ROWS + TAIL_ROWS;
  const shown = isTruncated
    ? [...data.slice(0, HEAD_ROWS), ...data.slice(data.length - TAIL_ROWS)]
    : data;
  const gapAt = isTruncated ? HEAD_ROWS : -1;
  const omitted = data.length - HEAD_ROWS - TAIL_ROWS;

  const cols = (
    <colgroup>
      {columns.map((c) => (
        <col key={c} style={{ width: `${(100 / columns.length).toFixed(3)}%` }} />
      ))}
    </colgroup>
  );

  const head = (
    <thead>
      <tr className="border-b border-zinc-200 bg-zinc-100 text-left text-zinc-500 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-400">
        {columns.map((c, i) => (
          <th
            key={c}
            className={`py-2 pr-2 font-medium leading-tight ${
              i > 0 ? "text-right" : ""
            }`}
          >
            {c}
          </th>
        ))}
      </tr>
    </thead>
  );

  const renderRow = (row: ReinvestCashFlowRow) => (
    <tr
      key={row.date}
      className={`border-b border-zinc-100 last:border-0 dark:border-zinc-900 ${
        row.maturityKrw ? "bg-orange-50/60 font-medium dark:bg-orange-950/20" : ""
      }`}
    >
      <td className="py-2 pr-2 text-zinc-700 dark:text-zinc-300">
        {row.date}
      </td>
      <td className="py-2 pr-2 text-right tabular-nums">
        {units(row.unitsBefore)}
      </td>
      <td className="py-2 pr-2 text-right tabular-nums">
        {brl(row.couponBrl)}
      </td>
      <td className="py-2 pr-2 text-right tabular-nums">
        {row.reinvestPu ? brl(row.reinvestPu) : ""}
      </td>
      <td className="py-2 pr-2 text-right tabular-nums">
        {units(row.unitsBought)}
      </td>
      <td className="py-2 pr-2 text-right tabular-nums font-medium">
        {units(row.unitsAfter)}
      </td>
      <td className="py-2 pr-2 text-right tabular-nums text-zinc-500 dark:text-zinc-400">
        {brl(row.cashBrl)}
      </td>
      <td className="py-2 text-right tabular-nums font-semibold text-zinc-900 dark:text-zinc-100">
        {row.maturityKrw ? krw(row.maturityKrw) : ""}
      </td>
    </tr>
  );

  return (
    <section className="rounded-2xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-950 sm:p-6 print:p-2">
      <h2 className="mb-5 text-base font-semibold text-zinc-900 dark:text-zinc-100 print:mb-1">
        현금흐름표{" "}
        <span className="text-xs font-normal text-zinc-400">
          (재투자형 — 쿠폰으로 채권 재매수, 만기 일괄 회수)
        </span>
      </h2>

      {data.length === 0 ? (
        <p className="text-sm text-zinc-500 dark:text-zinc-400">
          채권정보와 신탁계약일, 신탁투자금액, 선취/후취보수율을 모두 입력하면
          현금흐름표가 표시됩니다.
        </p>
      ) : (
        <>
          {/* 화면: 전체 행 */}
          <div className="overflow-x-auto print:hidden">
            <table className="w-full min-w-[760px] table-fixed text-sm">
              {cols}
              {head}
              <tbody>{data.map((row) => renderRow(row))}</tbody>
            </table>
          </div>

          {/* 인쇄: 앞/뒤 일부만 */}
          <div className="hidden overflow-x-auto print:block">
            <table className="w-full min-w-[760px] table-fixed text-sm">
              {cols}
              {head}
              <tbody>
                {shown.map((row, i) => (
                  <Fragment key={`${row.date}-${i}`}>
                    {i === gapAt && (
                      <tr className="border-b border-zinc-100 dark:border-zinc-900">
                        <td
                          colSpan={columns.length}
                          className="py-2 text-center text-xs text-zinc-400 dark:text-zinc-600"
                        >
                          ⋮ 중간 {omitted.toLocaleString("ko-KR")}건 생략 ⋮
                        </td>
                      </tr>
                    )}
                    {renderRow(row)}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      <div className="mt-6 space-y-0.5 text-xs leading-relaxed text-zinc-500 dark:text-zinc-400 print:mt-1 print:space-y-0">
        <p>
          - 재매수 시 금리는 최초 매수금리로 가정합니다(재매수단가는 잔존만기가
          줄며 액면가 R$1,000으로 수렴).
        </p>
        <p>
          - 매수좌수 = (전기 잔여현금 + 당기 이자) ÷ 재매수단가, 정수 내림.
        </p>
        <p>
          - 수령한 쿠폰(BRL)으로 같은 채권을 재매수하며, 남는 BRL은 다음 회차
          재투자에 씁니다. BRL 보유현금에는 현금성이자가 없습니다.
        </p>
        <p>
          - 원화 금액은 만기 회수 시에만 발생하며(원금상환 + 마지막 쿠폰 + 잔여
          현금), 전 기간 후취보수를 차감했습니다.
        </p>
        <p>- 단순계산 추정치입니다.</p>
      </div>
    </section>
  );
}
