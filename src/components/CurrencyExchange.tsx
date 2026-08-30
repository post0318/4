"use client";

import { useState } from "react";
import { digitsOnly, groupDigits, normalizeDecimalInput } from "@/lib/format";

interface Props {
  /** 원/달러 환율 (Frankfurter). 고시환율 칸 자동값으로 쓴다. */
  usdKrw: number | null;
}

const sanitizeDecimal = normalizeDecimalInput;

/**
 * 환전금액 — 원화금액 ÷ 고시환율 = 달러금액.
 * 세 칸 모두 직접 수정 가능. 고시환율은 건드리기 전까지 원/달러 환율을 자동 반영하고,
 * 마지막으로 입력한 칸(원화 또는 달러)이 다른 칸을 계산한다. 통화기호는 쓰지 않는다.
 */
export function CurrencyExchange({ usdKrw }: Props) {
  const [krw, setKrw] = useState("");
  const [usd, setUsd] = useState("");
  const [rate, setRate] = useState("");
  const [rateEdited, setRateEdited] = useState(false);
  const [driver, setDriver] = useState<"krw" | "usd">("krw");

  const autoRate = usdKrw != null ? usdKrw.toFixed(2) : "";
  const effRate = rateEdited ? rate : autoRate;
  const rateNum = parseFloat(effRate) || 0;
  const krwNum = parseInt(krw || "0", 10) || 0;
  const usdNum = parseFloat(usd || "0") || 0;

  const krwView =
    driver === "krw"
      ? groupDigits(krw)
      : rateNum > 0 && usdNum > 0
        ? groupDigits(String(Math.round(usdNum * rateNum)))
        : "";
  const usdView =
    driver === "usd"
      ? usd
      : rateNum > 0 && krwNum > 0
        ? (krwNum / rateNum).toFixed(2)
        : "";

  const field =
    "w-full rounded border border-zinc-300 px-2 py-1.5 text-right text-sm tabular-nums outline-none focus:border-blue-400 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100";

  return (
    <section className="rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-950">
      <h2 className="mb-3 text-sm font-semibold text-zinc-900 dark:text-zinc-100">
        환전금액
      </h2>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <label className="block">
          <span className="mb-1 block text-xs text-zinc-500 dark:text-zinc-400">
            원화금액
          </span>
          <input
            inputMode="numeric"
            value={krwView}
            placeholder="예: 10,000,000"
            maxLength={17}
            onChange={(e) => {
              setDriver("krw");
              setKrw(digitsOnly(e.target.value));
            }}
            className={field}
          />
        </label>

        <label className="block">
          <span className="mb-1 flex items-baseline justify-between text-xs text-zinc-500 dark:text-zinc-400">
            고시환율
            {rateEdited && (
              <button
                type="button"
                onClick={() => {
                  setRateEdited(false);
                  setRate("");
                }}
                className="text-[11px] text-blue-600 hover:underline dark:text-blue-400"
              >
                자동값
              </button>
            )}
          </span>
          <input
            inputMode="decimal"
            value={effRate}
            placeholder={autoRate || "원/달러"}
            maxLength={12}
            onChange={(e) => {
              setRateEdited(true);
              setRate(sanitizeDecimal(e.target.value));
            }}
            className={`${field} ${
              rateEdited
                ? "border-blue-400 font-semibold text-blue-700 dark:text-blue-300"
                : ""
            }`}
          />
        </label>

        <label className="block">
          <span className="mb-1 block text-xs text-zinc-500 dark:text-zinc-400">
            달러금액
          </span>
          <input
            inputMode="decimal"
            value={usdView}
            placeholder="원화금액 ÷ 고시환율"
            maxLength={17}
            onChange={(e) => {
              setDriver("usd");
              setUsd(sanitizeDecimal(e.target.value));
            }}
            className={field}
          />
        </label>
      </div>

      <p className="mt-2 text-[11px] text-zinc-400">
        원화금액 ÷ 고시환율 = 달러금액. 고시환율은 수정 전까지 원/달러 환율을 자동
        반영합니다.
      </p>
    </section>
  );
}
