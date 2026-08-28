"use client";

import { fmtInt, fmtNum } from "@/lib/format";
import type { OrderResult } from "@/lib/quantity";

interface OrderFormProps {
  krwInput: string;
  onKrwChange: (value: string) => void;
  pu: number | null;
  settlementDate: string | null;
  result: OrderResult | null;
  /** 계산에 필요한 선행 입력(환율·종목)이 아직 준비 안 됨 */
  waiting: string | null;
}

/**
 * 원화투자금액 입력 → 달러 환전액 자동 반영 → 매수수량 산출 (요구사항 3).
 */
export function OrderForm({
  krwInput,
  onKrwChange,
  pu,
  settlementDate,
  result,
  waiting,
}: OrderFormProps) {
  return (
    <section className="rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-950">
      <h2 className="mb-3 text-sm font-semibold text-zinc-900 dark:text-zinc-100">
        투자금액 · 매수수량
      </h2>

      <label className="block text-xs text-zinc-500 dark:text-zinc-400">
        원화투자금액 (KRW)
      </label>
      <input
        inputMode="numeric"
        value={krwInput}
        onChange={(e) => onKrwChange(e.target.value.replace(/[^\d]/g, ""))}
        placeholder="예: 10000000"
        className="mt-1 w-full rounded-md border border-zinc-300 px-3 py-2 text-right text-lg font-semibold tabular-nums outline-none focus:border-blue-400 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100"
      />
      {krwInput && (
        <p className="mt-1 text-right text-xs text-zinc-400">
          ₩ {fmtInt(Number(krwInput))}
        </p>
      )}

      {waiting && (
        <p className="mt-3 rounded-md bg-zinc-50 px-3 py-2 text-xs text-zinc-500 dark:bg-zinc-900 dark:text-zinc-400">
          {waiting}
        </p>
      )}

      {!waiting && (
        <div className="mt-4 space-y-3">
          <Row label="매수단가 (PU)" value={pu !== null ? `R$ ${fmtNum(pu, 4)}` : "-"} sub={settlementDate ? `결제일 ${settlementDate} (D+0)` : undefined} />
          {result && (
            <>
              <Row label="환전된 달러금액" value={`US$ ${fmtNum(result.usdAmount, 2)}`} />
              <Row label="헤알 환산액" value={`R$ ${fmtNum(result.brlAmount, 2)}`} />
              <div className="rounded-lg bg-blue-50 p-3 dark:bg-blue-950/40">
                <p className="text-xs text-blue-700 dark:text-blue-300">매수수량</p>
                <p className="mt-0.5 text-2xl font-bold tabular-nums text-blue-800 dark:text-blue-200">
                  {fmtInt(result.quantity)} <span className="text-base font-medium">좌</span>
                </p>
                <p className="text-[11px] text-blue-600/80 dark:text-blue-300/80">
                  1좌 = 액면 R$1,000 · 헤알 환산액 ÷ PU 정수 절사
                </p>
              </div>
              <Row label="실매수금액 (BRL)" value={`R$ ${fmtNum(result.brlCost, 2)}`} />
              <Row label="실매수금액 (USD 환산)" value={`US$ ${fmtNum(result.usdCost, 2)}`} />
              <Row label="실매수금액 (KRW 환산)" value={`₩ ${fmtInt(result.krwCost)}`} />
              <Row label="잔여현금 (BRL)" value={`R$ ${fmtNum(result.brlLeftover, 2)}`} />
              <Row label="잔여현금 (KRW 환산)" value={`₩ ${fmtInt(result.krwLeftover)}`} />
            </>
          )}
        </div>
      )}
    </section>
  );
}

function Row({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <span className="text-xs text-zinc-500 dark:text-zinc-400">
        {label}
        {sub && <span className="ml-1 text-[11px] text-zinc-400">· {sub}</span>}
      </span>
      <span className="tabular-nums font-medium text-zinc-900 dark:text-zinc-100">
        {value}
      </span>
    </div>
  );
}
