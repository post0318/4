"use client";

import {
  Dispatch,
  FocusEvent,
  KeyboardEvent,
  ReactNode,
  SetStateAction,
  useMemo,
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
  getRecentCouponDate,
  getSettlementDate,
  getTrustMaturityDate,
} from "@/lib/cashflow/couponSchedule";
import { computeBondPricing } from "@/lib/cashflow/bondPricing";
import { generateFixCashFlow } from "@/lib/cashflow/cashFlowSchedule";
import { generateMonthlyCashFlow } from "@/lib/cashflow/monthlyCashFlow";
import { generateReinvestCashFlow } from "@/lib/cashflow/reinvestCashFlow";
import { computeMaturitySummary } from "@/lib/cashflow/maturitySummary";
import { encodeBondLink } from "@/lib/cashflow/bondLink";
import { BrazilBondSearchBox } from "@/components/cashflow/BrazilBondSearchBox";

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

interface BondLayoutFormProps {
  value: BondLayoutInput;
  onChange: Dispatch<SetStateAction<BondLayoutInput>>;
  locked: boolean;
  onLockedChange: (locked: boolean) => void;
  lockToggleDisabled?: boolean;
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
  label: string;
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
}: BondLayoutFormProps) {
  const [linkStatus, setLinkStatus] = useState<string | null>(null);
  // 고객 공유용 — 링크로 연 화면에서 트레이딩(주문) 탭을 숨긴다. 기본 켜짐.
  const [hideTradingInLink, setHideTradingInLink] = useState(true);

  const update = <K extends keyof BondLayoutInput>(
    key: K,
    val: BondLayoutInput[K]
  ) => onChange({ ...value, [key]: val });

  const pricing = useMemo(
    () =>
      computeBondPricing({
        maturityDate: value.maturityDate,
        couponRate: value.couponRate,
        couponFrequency: value.couponFrequency,
        purchaseYield: value.purchaseYield,
        calcBasis: value.calcBasis,
        trustContractDate: value.trustContractDate,
        recentCouponDate: value.recentCouponDate,
        tradeCurrency: value.tradeCurrency,
        custodyCurrency: value.custodyCurrency,
        purchaseFxRate: value.purchaseFxRate,
        trustInvestmentAmount: value.trustInvestmentAmount,
        frontFeeRate: value.frontFeeRate,
        reserveRate:
          value.distributionType === "월" ? value.reserveRate : "0",
      }),
    [
      value.maturityDate,
      value.couponRate,
      value.couponFrequency,
      value.purchaseYield,
      value.calcBasis,
      value.trustContractDate,
      value.recentCouponDate,
      value.tradeCurrency,
      value.custodyCurrency,
      value.purchaseFxRate,
      value.trustInvestmentAmount,
      value.frontFeeRate,
      value.distributionType,
      value.reserveRate,
    ]
  );

  const cashFlowRows = useMemo(
    () =>
      generateFixCashFlow({
        maturityDate: value.maturityDate,
        couponRate: value.couponRate,
        couponFrequency: value.couponFrequency,
        purchaseYield: value.purchaseYield,
        calcBasis: value.calcBasis,
        trustContractDate: value.trustContractDate,
        recentCouponDate: value.recentCouponDate,
        tradeCurrency: value.tradeCurrency,
        custodyCurrency: value.custodyCurrency,
        purchaseFxRate: value.purchaseFxRate,
        maturityFxRate: value.maturityFxRate,
        trustInvestmentAmount: value.trustInvestmentAmount,
        frontFeeRate: value.frontFeeRate,
        backFeeRate: value.backFeeRate,
        cashInterestRate: value.cashInterestRate,
        taxStatus: value.taxStatus,
      }),
    [
      value.maturityDate,
      value.couponRate,
      value.couponFrequency,
      value.purchaseYield,
      value.calcBasis,
      value.trustContractDate,
      value.recentCouponDate,
      value.tradeCurrency,
      value.custodyCurrency,
      value.purchaseFxRate,
      value.maturityFxRate,
      value.trustInvestmentAmount,
      value.frontFeeRate,
      value.backFeeRate,
      value.cashInterestRate,
      value.taxStatus,
    ]
  );

  const maturitySummary = useMemo(
    () =>
      pricing && cashFlowRows
        ? computeMaturitySummary(pricing, cashFlowRows, {
            trustContractDate: value.trustContractDate,
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
      value.maturityDate,
      value.trustInvestmentAmount,
      value.backFeeRate,
      value.tradeCurrency,
      value.custodyCurrency,
      value.maturityFxRate,
      value.incomeTaxRate,
    ]
  );

  const monthlySummary = useMemo(() => {
    if (value.distributionType !== "월") return null;
    const r = generateMonthlyCashFlow({
      maturityDate: value.maturityDate,
      couponRate: value.couponRate,
      couponFrequency: value.couponFrequency,
      purchaseYield: value.purchaseYield,
      calcBasis: value.calcBasis,
      trustContractDate: value.trustContractDate,
      recentCouponDate: value.recentCouponDate,
      tradeCurrency: value.tradeCurrency,
      custodyCurrency: value.custodyCurrency,
      purchaseFxRate: value.purchaseFxRate,
      maturityFxRate: value.maturityFxRate,
      trustInvestmentAmount: value.trustInvestmentAmount,
      frontFeeRate: value.frontFeeRate,
      backFeeRate: value.backFeeRate,
      cashInterestRate: value.cashInterestRate,
      reserveRate: value.reserveRate,
      taxStatus: value.taxStatus,
      comprehensiveTaxRate: value.incomeTaxRate,
    });
    // 보유현금 마이너스(유보율 부족)면 수익률 결과를 내지 않는다
    return r && !r.error ? r.summary : null;
  }, [
      value.distributionType,
      value.maturityDate,
      value.couponRate,
      value.couponFrequency,
      value.purchaseYield,
      value.calcBasis,
      value.trustContractDate,
      value.recentCouponDate,
      value.tradeCurrency,
      value.custodyCurrency,
      value.purchaseFxRate,
      value.maturityFxRate,
      value.trustInvestmentAmount,
      value.frontFeeRate,
      value.backFeeRate,
      value.cashInterestRate,
      value.reserveRate,
      value.taxStatus,
      value.incomeTaxRate,
    ]
  );

  const reinvestSummary = useMemo(() => {
    if (value.distributionType !== "재투자") return null;
    const r = generateReinvestCashFlow({
      maturityDate: value.maturityDate,
      couponRate: value.couponRate,
      couponFrequency: value.couponFrequency,
      purchaseYield: value.purchaseYield,
      calcBasis: value.calcBasis,
      trustContractDate: value.trustContractDate,
      recentCouponDate: value.recentCouponDate,
      tradeCurrency: value.tradeCurrency,
      custodyCurrency: value.custodyCurrency,
      purchaseFxRate: value.purchaseFxRate,
      maturityFxRate: value.maturityFxRate,
      trustInvestmentAmount: value.trustInvestmentAmount,
      frontFeeRate: value.frontFeeRate,
      backFeeRate: value.backFeeRate,
      taxStatus: value.taxStatus,
      comprehensiveTaxRate: value.incomeTaxRate,
    });
    if (!r) return null;
    const fx = Number(value.maturityFxRate) || 1;
    return {
      investedPrincipal: Number(value.trustInvestmentAmount) || 0,
      totalInterest: r.summary.totalCouponBrl * fx,
      postTaxMaturityAmount: r.summary.postTaxMaturityKrw,
      postTaxYield: r.summary.postTaxYield,
      bankEquivalentYield: r.summary.bankEquivalentYield,
    };
  }, [
    value.distributionType,
    value.maturityDate,
    value.couponRate,
    value.couponFrequency,
    value.purchaseYield,
    value.calcBasis,
    value.trustContractDate,
    value.recentCouponDate,
    value.tradeCurrency,
    value.custodyCurrency,
    value.purchaseFxRate,
    value.maturityFxRate,
    value.trustInvestmentAmount,
    value.frontFeeRate,
    value.backFeeRate,
    value.taxStatus,
    value.incomeTaxRate,
  ]);

  const summary =
    value.distributionType === "월"
      ? monthlySummary
      : value.distributionType === "재투자"
        ? reinvestSummary
        : maturitySummary;

  const handleCreateLink = async () => {
    const link = encodeBondLink(value, { hideTrading: hideTradingInLink });
    try {
      await navigator.clipboard.writeText(link);
      setLinkStatus("링크를 클립보드에 복사했습니다.");
    } catch {
      setLinkStatus(link);
    }
  };

  return (
    <section className="rounded-2xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-950 sm:p-6 print:p-2">
      <div className="mb-5 flex items-center gap-3 print:hidden">
        <h2 className="text-base font-semibold text-zinc-900 dark:text-zinc-100">
          입력 레이아웃
        </h2>
        {/* 편입자산정보가 잠겨 있어도 검색창은 계속 쓸 수 있어야 다른 종목을
            검색해 새로 반영할 수 있다(검색으로 새 종목을 반영하면
            onLockedChange(false)로 잠금을 푼다). 반면 공유 링크로 연 화면
            (lockToggleDisabled=isSharedLink)은 배포된 값을 그대로 봐야
            하므로 검색 자체를 막는다. */}
        <BrazilBondSearchBox
          disabled={lockToggleDisabled}
          autoDefault={!lockToggleDisabled && !value.maturityDate}
          onApply={(fields) => {
            onLockedChange(false);
            onChange((prev) => ({ ...prev, ...fields }));
          }}
        />
      </div>

      {value.name && (
        <>
          <p className="hidden print:block text-[10pt]">&nbsp;</p>
          <p className="mb-4 print:mb-0 text-center text-[18pt] print:text-[30pt] print:tracking-normal font-bold underline text-zinc-900 dark:text-zinc-100">
            {`(${value.tradeCurrency}) ${value.name}`}
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
          <button
            type="button"
            onClick={handleCreateLink}
            className="inline-flex w-fit items-center gap-1.5 rounded-lg border border-zinc-300 bg-white px-3 py-1.5 text-sm font-medium text-zinc-700 transition-colors hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300 dark:hover:bg-zinc-800"
          >
            링크 생성
          </button>
          <label className="inline-flex w-fit cursor-pointer items-center gap-1.5 text-sm text-zinc-600 dark:text-zinc-400">
            <input
              type="checkbox"
              checked={hideTradingInLink}
              onChange={(e) => setHideTradingInLink(e.target.checked)}
              className="h-3.5 w-3.5 rounded border-zinc-300 dark:border-zinc-600"
            />
            트레이딩 탭 숨김
          </label>
          <button
            type="button"
            disabled={lockToggleDisabled}
            onClick={() => onLockedChange(!locked)}
            className={
              locked
                ? "inline-flex w-fit items-center gap-1 rounded-lg border border-amber-300 bg-amber-50 px-3 py-1.5 text-sm font-medium text-amber-700 transition-colors hover:bg-amber-100 disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:bg-amber-50 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-400 dark:disabled:hover:bg-amber-950/40"
                : "inline-flex w-fit items-center gap-1 rounded-lg border border-zinc-300 bg-white px-3 py-1.5 text-sm font-medium text-zinc-500 transition-colors hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:bg-white dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:disabled:hover:bg-zinc-900"
            }
          >
            {locked ? "🔒 편입자산정보 잠김 (해제)" : "🔓 편입자산정보 잠금"}
          </button>
          {linkStatus && (
            <p className="ml-2 whitespace-nowrap text-xs text-zinc-500 dark:text-zinc-400">
              {linkStatus}
            </p>
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
              className={inputClass}
              type="date"
              value={
                value.recentCouponDate ||
                getRecentCouponDate(
                  value.maturityDate,
                  value.couponFrequency,
                  getSettlementDate(value.trustContractDate) ?? undefined
                ) ||
                ""
              }
              disabled={locked}
              onChange={(e) =>
                update("recentCouponDate", clampDateYear(e.target.value))
              }
              onKeyDown={commitOnEnter}
            />
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
                  if (PERCENT_INPUT_PATTERN.test(_v)) update("purchaseYield", _v);
              }}
              onBlur={(e) =>
                update("purchaseYield", formatTwoDecimals(e.target.value))
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
              onFocus={selectAllOnFocus}
              onChange={(e) => {
                const _v = normalizeDecimalInput(e.target.value);
                  if (PERCENT_INPUT_PATTERN.test(_v)) update("purchaseFxRate", _v);
              }}
              onBlur={(e) => {
                const formatted = formatTwoDecimals(e.target.value);
                if (value.custodyCurrency !== value.tradeCurrency) {
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
          <Row label="신탁만기일">
            {getTrustMaturityDate(value.maturityDate) ? (
              <span className="text-sm text-zinc-900 dark:text-zinc-100">
                {getTrustMaturityDate(value.maturityDate)}
              </span>
            ) : (
              <ComputedValue />
            )}
          </Row>
          <Row label="투자일수">
            {(() => {
              const days = getInvestmentDays(
                value.trustContractDate,
                value.maturityDate
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
            {summary ? (
              <span className="text-sm text-zinc-900 dark:text-zinc-100">
                {formatSettlementAmount(
                  summary.totalInterest,
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
                {formatSettlementAmount(
                  summary.postTaxMaturityAmount,
                  value.custodyCurrency === "KRW"
                )}
              </span>
            ) : (
              <ComputedValue />
            )}
          </Row>
          <Row label="세후수익률">
            {summary ? (
              <span className="text-sm text-zinc-900 dark:text-zinc-100">
                {(summary.postTaxYield * 100).toFixed(2)}%
              </span>
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
                {(summary.bankEquivalentYield * 100).toFixed(2)}%
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
