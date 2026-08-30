"use client";

import { useMemo, useState } from "react";
import { BondLayoutForm } from "@/components/cashflow/BondLayoutForm";
import { CashFlowTable } from "@/components/cashflow/CashFlowTable";
import { MonthlyCashFlowTable } from "@/components/cashflow/MonthlyCashFlowTable";
import { ReinvestCashFlowTable } from "@/components/cashflow/ReinvestCashFlowTable";
import { generateFixCashFlow } from "@/lib/cashflow/cashFlowSchedule";
import { generateMonthlyCashFlow } from "@/lib/cashflow/monthlyCashFlow";
import { generateReinvestCashFlow } from "@/lib/cashflow/reinvestCashFlow";
import { decodeBondLink } from "@/lib/cashflow/bondLink";
import type { BondLayoutInput } from "@/lib/cashflow/bondLayout";

function todayDateString(): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function createDefaultInput(): BondLayoutInput {
  return {
    calcBasis: "Business/252",
    investorType: "개인",
    distributionType: "반기",
    name: "",
    issueDate: "",
    maturityDate: "",
    couponRate: "",
    couponFrequency: "6개월",
    recentCouponDate: "",
    taxStatus: "비과세",
    creditRating: "",
    tradeCurrency: "BRL",
    custodyCurrency: "KRW",
    purchaseFxRate: "",
    maturityFxRate: "",
    trustContractDate: todayDateString(),
    purchaseYield: "0.00",
    trustInvestmentAmount: "100000000",
    frontFeeRate: "0.00",
    backFeeRate: "0.00",
    incomeTaxRate: "15.40",
    cashInterestRate: "0.00",
    reserveRate: "0.00",
  };
}

function createInitialInput(): BondLayoutInput {
  if (typeof window === "undefined") return createDefaultInput();
  const decoded = decodeBondLink(window.location.search);
  return decoded ? { ...createDefaultInput(), ...decoded } : createDefaultInput();
}

function createInitialLocked(): boolean {
  if (typeof window === "undefined") return false;
  return decodeBondLink(window.location.search) !== null;
}

/**
 * 현금흐름 탭 — 프로젝트 3(채권세상)의 브라질 NTN-F 현금흐름 계산기를 그대로 담는다.
 * 이자 지급을 월/반기 중 선택해 신탁 현금흐름표를 산출한다.
 */
export function CashFlowPanel() {
  const [input, setInput] = useState<BondLayoutInput>(createInitialInput);
  const [locked, setLocked] = useState<boolean>(createInitialLocked);
  const [isSharedLink] = useState<boolean>(createInitialLocked);

  const isMonthly = input.distributionType === "월";
  const isReinvest = input.distributionType === "재투자형";

  const reinvestResult = useMemo(
    () =>
      !isReinvest
        ? null
        : generateReinvestCashFlow({
            maturityDate: input.maturityDate,
            couponRate: input.couponRate,
            couponFrequency: input.couponFrequency,
            purchaseYield: input.purchaseYield,
            calcBasis: input.calcBasis,
            trustContractDate: input.trustContractDate,
            recentCouponDate: input.recentCouponDate,
            tradeCurrency: input.tradeCurrency,
            custodyCurrency: input.custodyCurrency,
            purchaseFxRate: input.purchaseFxRate,
            maturityFxRate: input.maturityFxRate,
            trustInvestmentAmount: input.trustInvestmentAmount,
            frontFeeRate: input.frontFeeRate,
            backFeeRate: input.backFeeRate,
            taxStatus: input.taxStatus,
            comprehensiveTaxRate: input.incomeTaxRate,
          }),
    [isReinvest, input]
  );

  const cashFlowRows = useMemo(
    () =>
      isMonthly || isReinvest
        ? null
        : generateFixCashFlow({
            maturityDate: input.maturityDate,
            couponRate: input.couponRate,
            couponFrequency: input.couponFrequency,
            purchaseYield: input.purchaseYield,
            calcBasis: input.calcBasis,
            trustContractDate: input.trustContractDate,
            recentCouponDate: input.recentCouponDate,
            tradeCurrency: input.tradeCurrency,
            custodyCurrency: input.custodyCurrency,
            purchaseFxRate: input.purchaseFxRate,
            maturityFxRate: input.maturityFxRate,
            trustInvestmentAmount: input.trustInvestmentAmount,
            frontFeeRate: input.frontFeeRate,
            backFeeRate: input.backFeeRate,
            cashInterestRate: input.cashInterestRate,
            taxStatus: input.taxStatus,
          }),
    [isMonthly, isReinvest, input]
  );

  const monthlyResult = useMemo(
    () =>
      !isMonthly
        ? null
        : generateMonthlyCashFlow({
            maturityDate: input.maturityDate,
            couponRate: input.couponRate,
            couponFrequency: input.couponFrequency,
            purchaseYield: input.purchaseYield,
            calcBasis: input.calcBasis,
            trustContractDate: input.trustContractDate,
            recentCouponDate: input.recentCouponDate,
            tradeCurrency: input.tradeCurrency,
            custodyCurrency: input.custodyCurrency,
            purchaseFxRate: input.purchaseFxRate,
            maturityFxRate: input.maturityFxRate,
            trustInvestmentAmount: input.trustInvestmentAmount,
            frontFeeRate: input.frontFeeRate,
            backFeeRate: input.backFeeRate,
            cashInterestRate: input.cashInterestRate,
            reserveRate: input.reserveRate,
            taxStatus: input.taxStatus,
            comprehensiveTaxRate: input.incomeTaxRate,
          }),
    [isMonthly, input]
  );

  return (
    <div className="flex flex-col gap-6 print:gap-2">
      <div className="flex items-center justify-between gap-3 print:hidden">
        <p className="text-xs font-bold text-red-600 dark:text-red-500">
          ※ 본 자료는 참고용이며, 불특정 다수에게 제공이 금지된 사내한 자료입니다.
        </p>
        <button
          type="button"
          onClick={() => window.print()}
          className="shrink-0 rounded-md border border-zinc-300 px-3 py-1.5 text-sm font-medium text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-900"
        >
          🖨 출력 (A4 가로)
        </button>
      </div>
      <p className="hidden text-xs font-bold text-red-600 print:block">
        ※ 본 자료는 참고용이며, 불특정 다수에게 제공이 금지된 사내한 자료입니다.
      </p>
      <BondLayoutForm
        value={input}
        onChange={setInput}
        locked={locked}
        onLockedChange={setLocked}
        lockToggleDisabled={isSharedLink}
      />
      {isReinvest ? (
        <ReinvestCashFlowTable
          rows={reinvestResult?.rows ?? null}
          summary={reinvestResult?.summary ?? null}
        />
      ) : isMonthly ? (
        <MonthlyCashFlowTable
          rows={monthlyResult?.rows ?? null}
          custodyCurrency={input.custodyCurrency}
          error={monthlyResult?.error ?? null}
        />
      ) : (
        <CashFlowTable
          rows={cashFlowRows}
          custodyCurrency={input.custodyCurrency}
        />
      )}
    </div>
  );
}
