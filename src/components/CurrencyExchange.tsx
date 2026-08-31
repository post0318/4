"use client";

import {
  digitsOnly,
  groupDecimal,
  groupDigits,
  normalizeDecimalInput,
  truncDecimals,
} from "@/lib/format";

/** 소수 max자리 이하 잘라내기 (달러 입력은 2자리까지만) */
function clampInputDecimals(s: string, max = 2): string {
  const dot = s.indexOf(".");
  return dot === -1 ? s : s.slice(0, dot + 1 + max);
}

export interface ExchangeState {
  /** 원화금액 (숫자 문자열) */
  krw: string;
  /** 달러금액 (숫자·소수점 문자열) */
  usd: string;
  /** 고시환율 (사용자 수정값) */
  rate: string;
  /** 고시환율을 자동값에서 수정함 */
  rateEdited: boolean;
  /** 마지막으로 직접 입력한 칸 — 다른 칸을 계산한다 */
  driver: "krw" | "usd";
}

export const EMPTY_EXCHANGE: ExchangeState = {
  krw: "",
  usd: "",
  rate: "",
  rateEdited: false,
  driver: "krw",
};

interface Props {
  /** 원/달러 환율 (Frankfurter). 고시환율 칸 자동값으로 쓴다. */
  usdKrw: number | null;
  value: ExchangeState;
  onChange: (next: ExchangeState) => void;
}

const sanitizeDecimal = normalizeDecimalInput;

/** value에서 고시환율 유효값(자동/수정)과 원화·달러 표시·계산값을 도출한다 */
export function deriveExchange(
  value: ExchangeState,
  usdKrw: number | null
): { rate: number; krwTotal: number; usdTotal: number } {
  const autoRate = usdKrw != null ? usdKrw.toFixed(2) : "";
  const effRate = value.rateEdited ? value.rate : autoRate;
  const rate = parseFloat(effRate) || 0;
  const krwTyped = parseInt(value.krw || "0", 10) || 0;
  const usdTyped = parseFloat(value.usd || "0") || 0;

  if (value.driver === "usd") {
    const krwTotal = rate > 0 && usdTyped > 0 ? Math.round(usdTyped * rate) : 0;
    return { rate, krwTotal, usdTotal: usdTyped };
  }
  const usdTotal = rate > 0 && krwTyped > 0 ? krwTyped / rate : 0;
  return { rate, krwTotal: krwTyped, usdTotal };
}

/**
 * 환전금액 — 원화금액 ÷ 고시환율 = 달러금액.
 * 세 칸 모두 직접 수정 가능. 고시환율은 건드리기 전까지 원/달러 환율을 자동 반영하고,
 * 마지막으로 입력한 칸(원화 또는 달러)이 다른 칸을 계산한다. 통화기호는 쓰지 않는다.
 * 원화금액은 아래 종목 표의 원화투자금액 합계와 일치해야 하고, 종목별 달러($)
 * 자동값은 이 달러금액을 원화투자금액 비중대로 나눠 채운다.
 */
export function CurrencyExchange({ usdKrw, value, onChange }: Props) {
  const autoRate = usdKrw != null ? usdKrw.toFixed(2) : "";
  const effRate = value.rateEdited ? value.rate : autoRate;
  const rateNum = parseFloat(effRate) || 0;
  const krwNum = parseInt(value.krw || "0", 10) || 0;
  const usdNum = parseFloat(value.usd || "0") || 0;

  const krwView =
    value.driver === "krw"
      ? groupDigits(value.krw)
      : rateNum > 0 && usdNum > 0
        ? groupDigits(String(Math.round(usdNum * rateNum)))
        : "";
  // 표시 달러금액은 배분(2자리 절사)과 같은 값이 되도록 반올림이 아니라 절사한다.
  const usdView = groupDecimal(
    value.driver === "usd"
      ? value.usd
      : rateNum > 0 && krwNum > 0
        ? truncDecimals(krwNum / rateNum, 2).toFixed(2)
        : ""
  );

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
            onChange={(e) =>
              onChange({
                ...value,
                driver: "krw",
                krw: digitsOnly(e.target.value),
              })
            }
            className={field}
          />
        </label>

        <label className="block">
          <span className="mb-1 flex items-baseline justify-between text-xs text-zinc-500 dark:text-zinc-400">
            고시환율
            {value.rateEdited && (
              <button
                type="button"
                onClick={() =>
                  onChange({ ...value, rateEdited: false, rate: "" })
                }
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
            onChange={(e) =>
              onChange({
                ...value,
                rateEdited: true,
                rate: sanitizeDecimal(e.target.value),
              })
            }
            className={`${field} ${
              value.rateEdited
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
            maxLength={20}
            onChange={(e) =>
              onChange({
                ...value,
                driver: "usd",
                usd: clampInputDecimals(sanitizeDecimal(e.target.value), 2),
              })
            }
            className={field}
          />
        </label>
      </div>

      <p className="mt-2 text-[11px] text-zinc-400">
        원화금액 ÷ 고시환율 = 달러금액. 고시환율은 수정 전까지 원/달러 환율을 자동
        반영합니다. 원화금액은 아래 표의 원화투자금액 합계와 같아야 합니다.
      </p>
    </section>
  );
}
