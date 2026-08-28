"use client";

import { fmtNum } from "@/lib/format";
import type { BondItem } from "@/lib/types";

interface BondSelectorProps {
  bonds: BondItem[];
  asOfDate: string | null;
  loading: boolean;
  error: string | null;
  selected: BondItem | null;
  onSelect: (bond: BondItem | null) => void;
}

/**
 * 브라질국채(NTN-F) 자동 표시 + 선택 종목의 ISIN·종목명·매수수익률 표시 (요구사항 2).
 */
export function BondSelector({
  bonds,
  asOfDate,
  loading,
  error,
  selected,
  onSelect,
}: BondSelectorProps) {
  return (
    <section className="rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-950">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
          종목 (NTN-F)
        </h2>
        <span className="text-[11px] text-zinc-400">
          {asOfDate ? `시세 기준일 ${asOfDate}` : ""}
        </span>
      </div>

      <select
        value={selected?.maturityDate ?? ""}
        disabled={loading || bonds.length === 0}
        onChange={(e) => {
          const b = bonds.find((x) => x.maturityDate === e.target.value) ?? null;
          onSelect(b);
        }}
        className="w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm outline-none focus:border-blue-400 disabled:opacity-50 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100"
      >
        <option value="">
          {loading ? "불러오는 중…" : "종목을 선택하세요"}
        </option>
        {bonds.map((b) => (
          <option key={b.maturityDate} value={b.maturityDate}>
            {b.nameKo} · 만기 {b.maturityDate} · 매수수익률{" "}
            {b.buyYieldPct !== null ? `${fmtNum(b.buyYieldPct, 2)}%` : "-"}
          </option>
        ))}
      </select>

      {error && <p className="mt-2 text-[11px] text-red-500">{error}</p>}

      {selected && (
        <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
          <div className="col-span-2">
            <dt className="text-xs text-zinc-500 dark:text-zinc-400">종목명</dt>
            <dd className="font-medium text-zinc-900 dark:text-zinc-100">
              {selected.nameKo}
              <span className="ml-1 text-xs font-normal text-zinc-400">
                {selected.namePt}
              </span>
            </dd>
          </div>
          <div>
            <dt className="text-xs text-zinc-500 dark:text-zinc-400">ISIN</dt>
            <dd className="font-medium tabular-nums text-zinc-900 dark:text-zinc-100">
              {selected.isin ?? "-"}
              {selected.isin && !selected.isinVerified && (
                <span className="ml-1 rounded bg-amber-100 px-1 text-[10px] font-medium text-amber-700 dark:bg-amber-900/40 dark:text-amber-300">
                  확인 필요
                </span>
              )}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-zinc-500 dark:text-zinc-400">만기일</dt>
            <dd className="font-medium tabular-nums text-zinc-900 dark:text-zinc-100">
              {selected.maturityDate}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-zinc-500 dark:text-zinc-400">표면이율</dt>
            <dd className="font-medium tabular-nums text-zinc-900 dark:text-zinc-100">
              연 {fmtNum(selected.couponRatePct, 2)}%
            </dd>
          </div>
          <div>
            <dt className="text-xs text-zinc-500 dark:text-zinc-400">
              매수수익률
            </dt>
            <dd className="font-medium tabular-nums text-zinc-900 dark:text-zinc-100">
              {selected.buyYieldPct !== null
                ? `연 ${fmtNum(selected.buyYieldPct, 2)}%`
                : "-"}
            </dd>
          </div>
        </dl>
      )}
    </section>
  );
}
