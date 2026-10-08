"use client";

import {
  Dispatch,
  FocusEvent,
  KeyboardEvent,
  ReactNode,
  SetStateAction,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { normalizeDecimalInput } from "@/lib/format";
import {
  BondLayoutInput,
  CalcBasis,
  CouponFrequency,
  DistributionType,
  InvestorType,
} from "@/lib/cashflow/bondLayout";
import {
  getInvestmentDays,
  checkRecentCouponDate,
  getTrustMaturityDate,
} from "@/lib/cashflow/couponSchedule";
import type { BondPricingResult } from "@/lib/cashflow/bondPricing";
import type { CashFlowRow } from "@/lib/cashflow/cashFlowSchedule";
import type { MonthlyCashFlowResult } from "@/lib/cashflow/monthlyCashFlow";
import type { ReinvestCashFlowResult } from "@/lib/cashflow/reinvestCashFlow";
import { computeMaturitySummary } from "@/lib/cashflow/maturitySummary";
import { BrazilBondSearchBox } from "@/components/cashflow/BrazilBondSearchBox";
import { QuoteFreshnessNote } from "@/components/QuoteFreshnessNote";
import type { QuoteFreshness } from "@/lib/types";

function formatAmount(n: number): string {
  return n.toLocaleString("ko-KR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

/**
 * 수탁통화가 KRW면 소수점 이하를 절사(trunc)해 정수로, 그 외는 소수점
 * 2자리까지 절사(반올림 아님)해 표시한다. 계산값(bondPricing.ts의
 * settlementAmount 등)도 동일한 절사 규칙을 쓰므로, "매수가능금액-결제금액"을
 * 직접 계산해도 화면의 현금잔액과 일치한다.
 */
function formatSettlementAmount(n: number, isKrw: boolean): string {
  if (isKrw) return Math.trunc(n).toLocaleString("ko-KR");
  const truncated = Math.trunc(n * 100) / 100;
  return truncated.toLocaleString("ko-KR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

/**
 * CashFlowPanel 이 한 번 계산한 결과. 예전에는 폼이 요약을 위해 같은 계산을 다시
 * 돌려 키 입력마다 두 번 계산됐다(감사 ⑤ 낮음 정리).
 */
export interface CashFlowCalc {
  pricing: BondPricingResult | null;
  /** 반기형일 때만 (월·재투자는 null) */
  cashFlowRows: CashFlowRow[] | null;
  monthlyResult: MonthlyCashFlowResult | null;
  reinvestResult: ReinvestCashFlowResult | null;
}

interface BondLayoutFormProps {
  /** 패널이 계산한 결과 (요약·매수단가 표시용) */
  calc: CashFlowCalc;
  value: BondLayoutInput;
  onChange: Dispatch<SetStateAction<BondLayoutInput>>;
  locked: boolean;
  onLockedChange: (locked: boolean) => void;
  lockToggleDisabled?: boolean;
  /** 「초기화」 — 입력값을 기본값으로, 잠금 해제 (공유 링크 화면에선 없음) */
  onReset?: () => void;
}

const CALC_BASIS_OPTIONS: CalcBasis[] = [
  "미국 30/360",
  "ACT/ACT",
  "ACT/360",
  "ACT/365",
  "유럽 30/360",
  "Business/252",
];

const INVESTOR_TYPE_OPTIONS: InvestorType[] = ["개인", "일반법인", "금융법인"];

const COUPON_FREQUENCY_OPTIONS: CouponFrequency[] = ["3개월", "6개월", "12개월"];

const DISTRIBUTION_TYPE_OPTIONS: DistributionType[] = ["반기", "월", "재투자"];

const cellBase = "flex items-center whitespace-nowrap px-3 py-2 print:py-1 text-sm border border-zinc-200 dark:border-zinc-800";
const labelCellClass = `${cellBase} bg-zinc-50 font-medium text-zinc-600 dark:bg-zinc-900 dark:text-zinc-400`;
const valueCellClass = `${cellBase} bg-white dark:bg-zinc-950`;
const editableValueCellClass = `${cellBase} bg-orange-50 dark:bg-orange-950/30`;
const strongValueCellClass = `${cellBase} bg-orange-300 dark:bg-orange-800/70 print:bg-white dark:print:bg-white`;
const blankCellClass =
  "flex items-center whitespace-nowrap px-3 py-2 print:py-1 text-sm border border-white bg-white dark:border-zinc-950 dark:bg-zinc-950";
const inputClass =
  "w-full bg-transparent text-sm text-zinc-900 outline-none disabled:cursor-not-allowed disabled:text-zinc-400 dark:text-zinc-100 dark:disabled:text-zinc-600";

const PERCENT_INPUT_PATTERN = /^\d*(\.\d{0,2})?$/;
/** 매수금리는 소수 4자리까지 — 종목 선택 시 들어오는 중간값 ∓ 호가차/2 (ANBIMA 지표 정밀도)를 그대로 받는다 */
const YIELD_INPUT_PATTERN = /^\d*(\.\d{0,4})?$/;

function selectAllOnFocus(e: FocusEvent<HTMLInputElement>) {
  e.target.select();
}

function commitOnEnter(e: KeyboardEvent<HTMLInputElement>) {
  if (e.key === "Enter") {
    e.currentTarget.blur();
  }
}

/** 연도가 4자리를 넘어가면 마지막 4자리만 남긴다(예: 20275 -> 0275) */
function clampDateYear(raw: string): string {
  const match = raw.match(/^(\d+)-(\d{2})-(\d{2})$/);
  if (!match) return raw;
  const [, year, month, day] = match;
  if (year.length <= 4) return raw;
  return `${year.slice(-4)}-${month}-${day}`;
}

function formatTwoDecimals(raw: string): string {
  if (raw === "") return raw;
  const num = Number(raw);
  return Number.isNaN(num) ? raw : num.toFixed(2);
}

/** 매수금리 표시 — 최소 2자리, 넣은 자릿수(최대 4자리)는 그대로 둔다(반올림으로 값이 바뀌지 않게) */
function formatYieldDecimals(raw: string): string {
  if (raw === "") return raw;
  const num = Number(raw);
  if (Number.isNaN(num)) return raw;
  const decimals = (raw.split(".")[1] ?? "").length;
  return num.toFixed(Math.min(4, Math.max(2, decimals)));
}

/** 선취보수(차감) = 신탁투자금액 x 선취보수율 */
function getFrontFeeAmount(
  trustInvestmentAmount: string,
  frontFeeRate: string
): number | null {
  if (!trustInvestmentAmount || !frontFeeRate) return null;
  const principal = Number(trustInvestmentAmount);
  const rate = Number(frontFeeRate);
  if (Number.isNaN(principal) || Number.isNaN(rate)) return null;
  return Math.trunc(principal * (rate / 100));
}

function Row({
  label,
  children,
  editable = false,
  blank = false,
  strong = false,
}: {
  label: ReactNode;
  children: ReactNode;
  editable?: boolean;
  blank?: boolean;
  strong?: boolean;
}) {
  return (
    <div className="grid grid-cols-2">
      <div className={blank ? blankCellClass : labelCellClass}>{label}</div>
      <div
        className={
          blank
            ? blankCellClass
            : strong
              ? strongValueCellClass
              : editable
                ? editableValueCellClass
                : valueCellClass
        }
      >
        {children}
      </div>
    </div>
  );
}

function ComputedValue() {
  return (
    <span className="text-sm italic text-zinc-400 dark:text-zinc-600">
      자동계산
    </span>
  );
}

/** 인쇄 시 select 대신 선택된 값만 텍스트로 보여준다 */
function PrintValue({ value }: { value: string }) {
  return <span className="hidden print:inline">{value}</span>;
}

function GroupCard({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="flex flex-col">
      <div className="border border-b-0 border-zinc-200 bg-zinc-100 px-3 py-2 print:py-1 text-sm font-semibold text-zinc-700 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-300">
        {title}
      </div>
      <div className="flex flex-col">{children}</div>
    </div>
  );
}

export function BondLayoutForm({
  value,
  onChange,
  locked,
  onLockedChange,
  lockToggleDisabled = false,
  onReset,
  calc,
}: BondLayoutFormProps) {
  // 검색창의 늦은 비동기 반영(신용등급·환율)이 잠금 뒤에 도착해도 덮어쓰지 않도록
  // 최신 잠금 상태를 ref로 본다(fetch 콜백은 옛 렌더의 props를 붙들고 있음).
  const lockedRef = useRef(locked);
  useEffect(() => {
    lockedRef.current = locked;
  }, [locked]);
  // 매수시점환율 포커스 시점 값 — blur 때 실제로 바뀐 경우에만 만기환율을 동기화.
  const purchaseFxAtFocusRef = useRef<string>("");

  // 환율 자동 채움. 예전에는 종목 검색창이 종목 선택 뒤 비동기로 받아 콜백으로
  // 넘겨줬는데, 그 콜백에 걸린 마운트·선택순번 가드에 막히면 조용히 누락됐다
  // (사용자 지적 2026-09-17: 종목·금리는 채워지는데 환율만 빈칸).
  // 여기서 직접 조회하면 비어 있을 때마다 스스로 채우고, 실패해도 다음 기회에
  // 다시 시도한다. 사용자가 이미 입력한 값은 건드리지 않는다.
  /*
   * 공유 링크 화면에서도 **잠금이 풀린 뒤에는** 환율을 채운다(오너 신고
   * 2026-09-22). 링크를 종목 없이 만들어 보내면, 받은 사람이 종목을 골라도
   * 환율이 빈칸으로 남아 현금흐름표가 아예 안 그려졌다 — 종목이 담긴 링크는
   * 환율도 함께 담겨 있어 멀쩡해 보였다. 링크를 그대로 보는 동안은 locked 라
   * 자동 조회가 돌지 않아 고객이 받은 숫자는 그대로다.
   */
  const needFx =
    value.tradeCurrency !== value.custodyCurrency &&
    !!value.maturityDate &&
    value.purchaseFxRate.trim() === "" &&
    !locked;
  const fxFetchedRef = useRef(false);
  useEffect(() => {
    if (!needFx || fxFetchedRef.current) return;
    fxFetchedRef.current = true;
    let cancelled = false;
    fetch(
      `/api/cashflow/fx-rate?base=${value.tradeCurrency}&quote=${value.custodyCurrency}`
    )
      .then((r) => r.json())
      .then((d: { rate?: number | null }) => {
        if (cancelled || typeof d.rate !== "number") return;
        const rate = String(d.rate);
        onChange((prev) =>
          // 그 사이 사용자가 직접 넣었으면 덮어쓰지 않는다
          prev.purchaseFxRate.trim() === ""
            ? { ...prev, purchaseFxRate: rate, maturityFxRate: rate }
            : prev
        );
      })
      .catch(() => {
        fxFetchedRef.current = false; // 실패 시 재시도 허용
      });
    return () => {
      cancelled = true;
    };
  }, [needFx, value.tradeCurrency, value.custodyCurrency, onChange]);

  const update = <K extends keyof BondLayoutInput>(
    key: K,
    val: BondLayoutInput[K]
  ) => onChange({ ...value, [key]: val });

  const { pricing, cashFlowRows, monthlyResult, reinvestResult } = calc;

  const maturitySummary = useMemo(
    () =>
      pricing && cashFlowRows
        ? computeMaturitySummary(pricing, cashFlowRows, {
            trustContractDate: value.trustContractDate,
            trustMaturityDate: value.trustMaturityDate,
            maturityDate: value.maturityDate,
            trustInvestmentAmount: value.trustInvestmentAmount,
            backFeeRate: value.backFeeRate,
            tradeCurrency: value.tradeCurrency,
            custodyCurrency: value.custodyCurrency,
            maturityFxRate: value.maturityFxRate,
            comprehensiveTaxRate: value.incomeTaxRate,
          })
        : null,
    [
      pricing,
      cashFlowRows,
      value.trustContractDate,
      value.trustMaturityDate,
      value.maturityDate,
      value.trustInvestmentAmount,
      value.backFeeRate,
      value.tradeCurrency,
      value.custodyCurrency,
      value.maturityFxRate,
      value.incomeTaxRate,
    ]
  );

  // 보유현금 마이너스(유보율 부족)면 수익률 결과를 내지 않는다
  const monthlySummary =
    monthlyResult && !monthlyResult.error ? monthlyResult.summary : null;

  const reinvestSummary = useMemo(() => {
    if (!reinvestResult) return null;
    // 만기환율이 없으면 헤알 쿠폰을 원화로 환산할 수 없다 — 1배로 두면 헤알값이
    // 원화처럼 표시되므로 null로 둔다 (감사 ⑤ 낮음).
    const fx = Number(value.maturityFxRate);
    return {
      investedPrincipal: Number(value.trustInvestmentAmount) || 0,
      totalInterest:
        Number.isFinite(fx) && fx > 0 ? reinvestResult.summary.totalCouponBrl * fx : null,
      postTaxMaturityAmount: reinvestResult.summary.postTaxMaturityKrw,
      postTaxYield: reinvestResult.summary.postTaxYield,
      postTaxCagr: reinvestResult.summary.postTaxCagr,
      bankEquivalentYield: reinvestResult.summary.bankEquivalentYield,
    };
  }, [reinvestResult, value.maturityFxRate, value.trustInvestmentAmount]);

  // 시세 기준일·노후 경고 — 종목 검색이 목록을 받을 때 채워진다(감사 ⑤ 중3)
  const [quote, setQuote] = useState<QuoteFreshness | null>(null);
  // 세후수익률 표시 기준: 끄면 단리 연환산, 켜면 복리(CAGR) (감사 ⑤ 중5)
  const [compoundBasis, setCompoundBasis] = useState(false);

  // 최근이표일 입력이 자동 계산값과 다르면 경고(계산은 자동값 사용, 감사 ⑤ 중4)
  const recentCoupon = checkRecentCouponDate(
    value.maturityDate,
    value.couponFrequency,
    value.trustContractDate,
    value.recentCouponDate
  );

  const summary =
    value.distributionType === "월"
      ? monthlySummary
      : value.distributionType === "재투자"
        ? reinvestSummary
        : maturitySummary;

  return (
    <section className="rounded-2xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-950 sm:p-6 print:p-2">
      <div className="mb-5 flex items-center gap-3 print:hidden">
        <h2 className="text-base font-semibold text-zinc-900 dark:text-zinc-100">
          입력 레이아웃
        </h2>
        {/* 편입자산정보가 잠겨 있어도, 그리고 공유 링크로 연 화면이어도 검색창은
            계속 쓸 수 있다 — 다른 종목을 검색해 새로 반영할 수 있어야 한다
            (검색으로 새 종목을 반영하면 onLockedChange(false)로 잠금을 푼다).
            (오너 지시, 2026-09-19 — 공유 링크에서도 채권 선택 가능하게) */}
        <BrazilBondSearchBox
          disabled={false}
          autoDefault={!lockToggleDisabled && !value.maturityDate}
          onApply={(fields) => {
            onLockedChange(false);
            onChange((prev) => ({ ...prev, ...fields }));
          }}
          onUpdate={(fields) => {
            // 늦게 도착한 신용등급·환율: 잠금을 다시 풀지 않고, 이미 잠갔으면 무시.
            if (lockedRef.current) return;
            onChange((prev) => ({ ...prev, ...fields }));
          }}
          onQuote={setQuote}
        />
        <QuoteFreshnessNote quote={quote} />
      </div>

      {value.name && (
        <>
          <p className="hidden print:block text-[10pt]">&nbsp;</p>
          <p className="mb-4 print:mb-0 text-center text-[18pt] print:text-[30pt] print:tracking-normal font-bold underline text-zinc-900 dark:text-zinc-100">
            {/* 거래통화 표기 (BRL) 는 뺐다 — 브라질 국채 전용이라 늘 같다(오너 지시 2026-09-22) */}
            {value.name}
          </p>
          <p className="hidden print:block text-[10pt]">&nbsp;</p>
          <p className="hidden print:block text-[10pt]">&nbsp;</p>
        </>
      )}

      {/* 소득자구분 / 편입자산정보 공유 링크 */}
      <div className="mb-4 print:mb-1 grid grid-cols-1 gap-4 md:grid-cols-3 print:hidden">
        <div className="grid grid-cols-1 gap-px overflow-hidden rounded-lg border border-zinc-200 dark:border-zinc-800">
          <Row label="소득자구분" editable>
            <select
              className={inputClass}
              value={value.investorType}
              onChange={(e) =>
                update("investorType", e.target.value as InvestorType)
              }
            >
              {INVESTOR_TYPE_OPTIONS.map((opt) => (
                <option key={opt} value={opt}>
                  {opt}
                </option>
              ))}
            </select>
          </Row>
        </div>
        <div className="flex flex-wrap items-center gap-2 print:hidden md:col-span-2">
          {/* 잠금 수동 토글 버튼은 삭제 — 공유 링크는 열람 시 자동으로 잠기고
              (isSharedLink), 종목 검색으로 새로 반영하면 자동으로 풀린다
              (onLockedChange(false)) — 오너 지시, 2026-09-19. 공유 링크
              생성은 별도 버튼(ShareLinkButton, 현금흐름 탭 상단). */}
          {!lockToggleDisabled && onReset && (
            <button
              type="button"
              onClick={onReset}
              className="inline-flex w-fit items-center rounded-lg border border-zinc-300 bg-white px-3 py-1.5 text-sm font-medium text-zinc-600 transition-colors hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300 dark:hover:bg-zinc-800"
            >
              초기화
            </button>
          )}
        </div>
      </div>

      {/* 편입자산정보 / 매수내역 / 상품수익률 */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-3 print:grid-cols-3 print:gap-2">
        <GroupCard title="편입자산정보">
          <Row label="종목명" editable>
            <input
              className={inputClass}
              type="text"
              placeholder="예: KORELE 7.95 04/01/2096"
              value={value.name}
              disabled={locked}
              onChange={(e) => update("name", e.target.value)}
              onKeyDown={commitOnEnter}
            />
          </Row>
          <Row label="발행일" editable>
            <input
              className={inputClass}
              type="date"
              value={value.issueDate}
              disabled={locked}
              onChange={(e) => update("issueDate", clampDateYear(e.target.value))}
              onKeyDown={commitOnEnter}
            />
          </Row>
          <Row label="만기일" editable>
            <input
              className={inputClass}
              type="date"
              value={value.maturityDate}
              disabled={locked}
              onChange={(e) => update("maturityDate", clampDateYear(e.target.value))}
              onKeyDown={commitOnEnter}
            />
          </Row>
          <Row label="표면이율(%)" editable>
            <input
              className={inputClass}
              type="text"
              inputMode="decimal"
              placeholder="예: 7.95"
              value={value.couponRate}
              disabled={locked}
              onFocus={selectAllOnFocus}
              onChange={(e) => {
                const _v = normalizeDecimalInput(e.target.value);
                  if (PERCENT_INPUT_PATTERN.test(_v)) update("couponRate", _v);
              }}
              onBlur={(e) => update("couponRate", formatTwoDecimals(e.target.value))}
              onKeyDown={commitOnEnter}
            />
          </Row>
          <Row label="이자지급 주기" editable>
            <select
              className={`${inputClass} print:hidden`}
              value={value.couponFrequency}
              disabled={locked}
              onChange={(e) =>
                update("couponFrequency", e.target.value as CouponFrequency)
              }
            >
              {COUPON_FREQUENCY_OPTIONS.map((opt) => (
                <option key={opt} value={opt}>
                  {opt}
                </option>
              ))}
            </select>
            <PrintValue value={value.couponFrequency} />
          </Row>
          <Row label="최근이표일" editable>
            <input
              className={
                recentCoupon.valid
                  ? inputClass
                  : `${inputClass} border-red-400 focus:border-red-500 dark:border-red-700`
              }
              type="date"
              value={value.recentCouponDate || recentCoupon.auto || ""}
              disabled={locked}
              aria-invalid={!recentCoupon.valid}
              onChange={(e) =>
                update("recentCouponDate", clampDateYear(e.target.value))
              }
              onKeyDown={commitOnEnter}
            />
            {!recentCoupon.valid && recentCoupon.auto && (
              <p
                role="alert"
                className="mt-1 text-[11px] leading-snug text-red-600 print:hidden dark:text-red-400"
              >
                결제일 직전 이표일({recentCoupon.auto})과 다릅니다. 계산에는 자동값을
                씁니다.{" "}
                <button
                  type="button"
                  onClick={() => update("recentCouponDate", "")}
                  className="underline"
                >
                  자동값 적용
                </button>
              </p>
            )}
          </Row>
          <Row label="날짜계산 기준" editable>
            <select
              className={`${inputClass} print:hidden`}
              value={value.calcBasis}
              disabled={locked}
              onChange={(e) =>
                update("calcBasis", e.target.value as CalcBasis)
              }
            >
              {CALC_BASIS_OPTIONS.map((opt) => (
                <option key={opt} value={opt}>
                  {opt}
                </option>
              ))}
            </select>
            <PrintValue value={value.calcBasis} />
          </Row>
          <Row label="신용등급" editable>
            <input
              className={inputClass}
              type="text"
              placeholder="예: 무디스: Aa2 / S&P: AA"
              value={value.creditRating}
              disabled={locked}
              onChange={(e) => update("creditRating", e.target.value)}
              onKeyDown={commitOnEnter}
            />
          </Row>
          <Row label="지급구분" editable strong>
            <select
              className={`${inputClass} print:hidden font-bold`}
              value={value.distributionType}
              onChange={(e) =>
                update("distributionType", e.target.value as DistributionType)
              }
            >
              {DISTRIBUTION_TYPE_OPTIONS.map((opt) => (
                <option key={opt} value={opt}>
                  {opt}
                </option>
              ))}
            </select>
            <PrintValue value={value.distributionType} />
          </Row>
          <Row label="유보율(%)" editable>
            <input
              className={inputClass}
              type="text"
              inputMode="decimal"
              value={
                value.distributionType === "월" ? value.reserveRate : "0.00"
              }
              disabled={value.distributionType !== "월"}
              onFocus={selectAllOnFocus}
              onChange={(e) => {
                const _v = normalizeDecimalInput(e.target.value);
                  if (PERCENT_INPUT_PATTERN.test(_v)) update("reserveRate", _v);
              }}
              onBlur={(e) =>
                update("reserveRate", formatTwoDecimals(e.target.value))
              }
              onKeyDown={commitOnEnter}
            />
          </Row>
          <Row label="거래통화">
            <span className="text-sm text-zinc-900 dark:text-zinc-100">BRL</span>
          </Row>
          <Row label="수탁통화">
            <span className="text-sm text-zinc-900 dark:text-zinc-100">KRW</span>
          </Row>
        </GroupCard>

        <GroupCard title="매수내역">
          <Row label="신탁투자금액" editable>
            <input
              className={inputClass}
              type="text"
              inputMode="numeric"
              placeholder="예: 1,000,000"
              value={
                value.trustInvestmentAmount === ""
                  ? ""
                  : Number(value.trustInvestmentAmount).toLocaleString(
                      "ko-KR"
                    )
              }
              onFocus={selectAllOnFocus}
              onChange={(e) => {
                const digits = e.target.value.replace(/,/g, "");
                if (/^\d*$/.test(digits)) {
                  update("trustInvestmentAmount", digits);
                }
              }}
              onKeyDown={commitOnEnter}
            />
          </Row>
          <Row label="선취보수(차감)">
            {(() => {
              const amount = getFrontFeeAmount(
                value.trustInvestmentAmount,
                value.frontFeeRate
              );
              return amount !== null ? (
                <span className="text-sm text-zinc-900 dark:text-zinc-100">
                  {amount.toLocaleString("ko-KR")}
                </span>
              ) : (
                <ComputedValue />
              );
            })()}
          </Row>
          <Row label="매수가능금액">
            {(() => {
              const frontFee = getFrontFeeAmount(
                value.trustInvestmentAmount,
                value.frontFeeRate
              );
              if (frontFee === null) return <ComputedValue />;
              const available = Number(value.trustInvestmentAmount) - frontFee;
              return (
                <span className="text-sm text-zinc-900 dark:text-zinc-100">
                  {available.toLocaleString("ko-KR")}
                </span>
              );
            })()}
          </Row>
          <Row label="채권권면액">
            {pricing ? (
              <span className="text-sm text-zinc-900 dark:text-zinc-100">
                {formatAmount(pricing.faceValue)}
              </span>
            ) : (
              <ComputedValue />
            )}
          </Row>
          <Row label="매수단가(clean)">
            {pricing ? (
              <span className="text-sm text-zinc-900 dark:text-zinc-100">
                {pricing.cleanPrice.toFixed(4)}
              </span>
            ) : (
              <ComputedValue />
            )}
          </Row>
          <Row label="매수단가(dirty)">
            {pricing ? (
              <span className="text-sm text-zinc-900 dark:text-zinc-100">
                {pricing.dirtyPrice.toFixed(4)}
              </span>
            ) : (
              <ComputedValue />
            )}
          </Row>
          <Row label="매수금리(YTM)" strong>
            <input
              className={`${inputClass} font-bold`}
              type="text"
              inputMode="decimal"
              placeholder="예: 5.30"
              value={value.purchaseYield}
              onFocus={selectAllOnFocus}
              onChange={(e) => {
                const _v = normalizeDecimalInput(e.target.value);
                  if (YIELD_INPUT_PATTERN.test(_v)) update("purchaseYield", _v);
              }}
              onBlur={(e) =>
                update("purchaseYield", formatYieldDecimals(e.target.value))
              }
              onKeyDown={commitOnEnter}
            />
          </Row>
          <Row
            label={
              value.tradeCurrency === "KRW"
                ? "경과이자"
                : value.calcBasis === "Business/252"
                  ? "경과이자(1000BRL)"
                  : "경과이자(100$)"
            }
          >
            {pricing ? (
              <span className="text-sm text-zinc-900 dark:text-zinc-100">
                {formatAmount(pricing.accruedInterest)}
              </span>
            ) : (
              <ComputedValue />
            )}
          </Row>
          <Row label="결제금액">
            {pricing ? (
              <span className="text-sm text-zinc-900 dark:text-zinc-100">
                {formatSettlementAmount(
                  pricing.settlementAmount,
                  value.custodyCurrency === "KRW"
                )}
              </span>
            ) : (
              <ComputedValue />
            )}
          </Row>
          <Row label="현금잔액">
            {pricing ? (
              <span className="text-sm text-zinc-900 dark:text-zinc-100">
                {formatSettlementAmount(
                  pricing.cashBalance,
                  value.custodyCurrency === "KRW"
                )}
              </span>
            ) : (
              <ComputedValue />
            )}
          </Row>
          <Row label="매수시점환율" editable>
            <input
              className={inputClass}
              type="text"
              inputMode="decimal"
              placeholder="예: 1449.60"
              value={value.purchaseFxRate}
              disabled={value.custodyCurrency === value.tradeCurrency}
              onFocus={(e) => {
                purchaseFxAtFocusRef.current = value.purchaseFxRate;
                selectAllOnFocus(e);
              }}
              onChange={(e) => {
                const _v = normalizeDecimalInput(e.target.value);
                  if (PERCENT_INPUT_PATTERN.test(_v)) update("purchaseFxRate", _v);
              }}
              onBlur={(e) => {
                const formatted = formatTwoDecimals(e.target.value);
                // 만기예상환율 동기화는 (1) 매수시점환율이 실제로 바뀌었고
                // (2) 만기예상환율을 사용자가 따로 손대지 않은 경우(비어 있거나
                // 이전 매수시점환율과 같음)에만. Tab으로 지나가기만 해도
                // 사용자가 입력한 만기환율이 초기화되던 문제 방지 (감사 ⑤ 중).
                const before = formatTwoDecimals(purchaseFxAtFocusRef.current);
                const changed = formatted !== before;
                const maturityUntouched =
                  value.maturityFxRate === "" ||
                  formatTwoDecimals(value.maturityFxRate) === before;
                if (
                  value.custodyCurrency !== value.tradeCurrency &&
                  changed &&
                  maturityUntouched
                ) {
                  onChange({
                    ...value,
                    purchaseFxRate: formatted,
                    maturityFxRate: formatted,
                  });
                } else {
                  update("purchaseFxRate", formatted);
                }
              }}
              onKeyDown={commitOnEnter}
            />
          </Row>
          <Row label="만기예상환율(예상)" editable>
            <input
              className={inputClass}
              type="text"
              inputMode="decimal"
              placeholder="예: 1449.60"
              value={value.maturityFxRate}
              disabled={value.custodyCurrency === value.tradeCurrency}
              onFocus={selectAllOnFocus}
              onChange={(e) => {
                const _v = normalizeDecimalInput(e.target.value);
                  if (PERCENT_INPUT_PATTERN.test(_v)) update("maturityFxRate", _v);
              }}
              onBlur={(e) =>
                update("maturityFxRate", formatTwoDecimals(e.target.value))
              }
              onKeyDown={commitOnEnter}
            />
          </Row>
        </GroupCard>

        <GroupCard title="상품수익률">
          <Row label="신탁계약일" editable>
            <input
              className={inputClass}
              type="date"
              value={value.trustContractDate}
              onChange={(e) =>
                update("trustContractDate", clampDateYear(e.target.value))
              }
              onKeyDown={commitOnEnter}
            />
          </Row>
          {/* 신탁만기일은 기본 자동(만기일 + 리드타임 11일)이고 수기 지정할 수
              있다. 지정하면 (지정일 − 만기일)이 리드타임이 되어 투자일수·만기청산
              후취보수·만기 구간 현금성이자에 모두 반영된다. "자동" 배지·복원
              버튼은 값 칸이 아니라 라벨 옆에 둔다(값 칸에 달력과 나란히 두면
              폭이 넘친다). */}
          <Row
            label={
              <span className="flex items-center gap-2">
                신탁만기일
                {value.trustMaturityDate.trim() !== "" ? (
                  <button
                    type="button"
                    onClick={() => update("trustMaturityDate", "")}
                    title="수기값을 지우고 자동계산(만기일 + 11일)으로 되돌립니다"
                    className="shrink-0 rounded border border-zinc-300 px-1.5 py-0.5 text-[11px] font-normal text-zinc-500 hover:bg-white print:hidden dark:border-zinc-700 dark:text-zinc-400 dark:hover:bg-zinc-900"
                  >
                    자동
                  </button>
                ) : (
                  <span
                    title="자동계산: 만기일 + 11일"
                    className="shrink-0 text-[11px] font-normal italic text-zinc-400 print:hidden dark:text-zinc-600"
                  >
                    자동
                  </span>
                )}
              </span>
            }
            editable
          >
            {(() => {
              const displayed =
                getTrustMaturityDate(value.maturityDate, value.trustMaturityDate) ?? "";
              const isOverridden = value.trustMaturityDate.trim() !== "";
              if (!isOverridden && displayed === "") return <ComputedValue />;
              // 신탁만기일은 자산만기일보다 이를 수 없다(중도상환 없는 상품).
              // 달력에서 만기일 이전을 고를 수 없게 막고, 직접 타이핑으로
              // 들어와도 저장하지 않는다.
              return (
                <input
                  className={inputClass}
                  type="date"
                  value={displayed}
                  min={value.maturityDate || undefined}
                  disabled={locked}
                  title="자산만기일 이후로만 지정할 수 있습니다"
                  onChange={(e) => {
                    const typed = clampDateYear(e.target.value);
                    if (
                      typed &&
                      value.maturityDate &&
                      typed < value.maturityDate
                    ) {
                      return;
                    }
                    update("trustMaturityDate", typed);
                  }}
                  onKeyDown={commitOnEnter}
                />
              );
            })()}
          </Row>
          <Row label="투자일수">
            {(() => {
              const days = getInvestmentDays(
                value.trustContractDate,
                value.maturityDate,
                value.trustMaturityDate
              );
              return days !== null ? (
                <span className="text-sm text-zinc-900 dark:text-zinc-100">
                  {days.toLocaleString("ko-KR")}일
                </span>
              ) : (
                <ComputedValue />
              );
            })()}
          </Row>
          <Row label="선취보수율(%)" editable>
            <input
              className={inputClass}
              type="text"
              inputMode="decimal"
              placeholder="예: 2.5"
              value={value.frontFeeRate}
              onFocus={selectAllOnFocus}
              onChange={(e) => {
                const _v = normalizeDecimalInput(e.target.value);
                  if (PERCENT_INPUT_PATTERN.test(_v)) update("frontFeeRate", _v);
              }}
              onBlur={(e) =>
                update("frontFeeRate", formatTwoDecimals(e.target.value))
              }
              onKeyDown={commitOnEnter}
            />
          </Row>
          <Row label="후취보수율(%)" editable>
            <input
              className={inputClass}
              type="text"
              inputMode="decimal"
              placeholder="예: 0.5"
              value={value.backFeeRate}
              onFocus={selectAllOnFocus}
              onChange={(e) => {
                const _v = normalizeDecimalInput(e.target.value);
                  if (PERCENT_INPUT_PATTERN.test(_v)) update("backFeeRate", _v);
              }}
              onKeyDown={commitOnEnter}
              onBlur={(e) =>
                update("backFeeRate", formatTwoDecimals(e.target.value))
              }
            />
          </Row>
          <Row label="현금성이율(%)" editable>
            <input
              className={inputClass}
              type="text"
              inputMode="decimal"
              placeholder="예: 2.0"
              value={value.cashInterestRate}
              onFocus={selectAllOnFocus}
              onChange={(e) => {
                const _v = normalizeDecimalInput(e.target.value);
                  if (PERCENT_INPUT_PATTERN.test(_v)) update("cashInterestRate", _v);
              }}
              onBlur={(e) =>
                update("cashInterestRate", formatTwoDecimals(e.target.value))
              }
              onKeyDown={commitOnEnter}
            />
          </Row>
          <Row label="경과이자차감 원금">
            {summary ? (
              <span className="text-sm text-zinc-900 dark:text-zinc-100">
                {formatSettlementAmount(
                  summary.investedPrincipal,
                  value.custodyCurrency === "KRW"
                )}
              </span>
            ) : (
              <ComputedValue />
            )}
          </Row>
          <Row label="지급이자 총액">
            {summary && summary.totalInterest == null ? (
              <span className="text-sm italic text-zinc-400 dark:text-zinc-600">
                만기환율 입력 필요
              </span>
            ) : summary ? (
              <span className="text-sm text-zinc-900 dark:text-zinc-100">
                {formatSettlementAmount(
                  summary.totalInterest ?? 0,
                  value.custodyCurrency === "KRW"
                )}
              </span>
            ) : (
              <ComputedValue />
            )}
          </Row>
          <Row label="만기시 세후금액">
            {summary ? (
              <span className="text-sm text-zinc-900 dark:text-zinc-100">
                {summary.postTaxMaturityAmount === null
                  ? "-"
                  : formatSettlementAmount(
                      summary.postTaxMaturityAmount,
                      value.custodyCurrency === "KRW"
                    )}
              </span>
            ) : (
              <ComputedValue />
            )}
          </Row>
          {/* 단리 연환산은 기간이 길수록 연 수익률을 부풀려 보이게 한다. 라벨 옆
              「복리기준」을 켜면 복리(CAGR)로 바꿔 보여준다(감사 ⑤ 중5).
              반기·월지급형은 쿠폰이 출금돼 신탁을 떠나므로 복리값에
              "(재투자없음)"을 붙인다 — 재투자형은 신탁 안에서 복리가 일어나
              가정이 필요 없으므로 붙이지 않는다. */}
          <Row
            label={
              <span className="inline-flex items-center gap-2">
                세후수익률
                <label
                  className="inline-flex cursor-pointer items-center gap-1 text-xs font-normal text-zinc-500 print:hidden dark:text-zinc-400"
                  title="복리(CAGR) = (총수령액/원금)^(365/투자일수) − 1"
                >
                  <input
                    type="checkbox"
                    checked={compoundBasis}
                    onChange={(e) => setCompoundBasis(e.target.checked)}
                    className="h-3 w-3 rounded border-zinc-300 dark:border-zinc-600"
                  />
                  복리기준
                </label>
              </span>
            }
          >
            {summary ? (
              compoundBasis ? (
                summary.postTaxCagr != null ? (
                  <span className="text-sm text-zinc-900 dark:text-zinc-100">
                    {(summary.postTaxCagr * 100).toFixed(2)}%
                    {value.distributionType !== "재투자" && (
                      <span className="ml-1 text-xs font-normal text-zinc-500 dark:text-zinc-400">
                        (재투자없음)
                      </span>
                    )}
                  </span>
                ) : (
                  <span className="text-sm text-zinc-400">-</span>
                )
              ) : (
                <span className="text-sm text-zinc-900 dark:text-zinc-100">
                  {summary.postTaxYield === null
                    ? "-"
                    : `${(summary.postTaxYield * 100).toFixed(2)}%`}
                </span>
              )
            ) : (
              <ComputedValue />
            )}
          </Row>
          <Row label="종합소득세율(%)" editable>
            <input
              className={inputClass}
              type="text"
              inputMode="decimal"
              placeholder="예: 15.4"
              value={value.incomeTaxRate}
              onFocus={selectAllOnFocus}
              onChange={(e) => {
                const _v = normalizeDecimalInput(e.target.value);
                  if (PERCENT_INPUT_PATTERN.test(_v)) update("incomeTaxRate", _v);
              }}
              onBlur={(e) =>
                update("incomeTaxRate", formatTwoDecimals(e.target.value))
              }
              onKeyDown={commitOnEnter}
            />
          </Row>
          <Row label="은행환산수익률">
            {summary ? (
              <span className="text-sm text-zinc-900 dark:text-zinc-100">
                {summary.bankEquivalentYield === null
                  ? "-"
                  : `${(summary.bankEquivalentYield * 100).toFixed(2)}%`}
              </span>
            ) : (
              <ComputedValue />
            )}
          </Row>
        </GroupCard>
      </div>
    </section>
  );
}
