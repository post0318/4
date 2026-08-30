import {
  CouponFrequency,
  Currency,
  CalcBasis,
  TaxStatus,
} from "@/lib/cashflow/bondLayout";
import { FREQUENCY_MONTHS, addMonths } from "@/lib/cashflow/couponSchedule";
import { computeBondPricing, roundDown } from "@/lib/cashflow/bondPricing";
import {
  CASH_INTEREST_TAX_RATE,
  getEffectiveIncomeTaxRate,
} from "@/lib/cashflow/taxRules";

export interface CashFlowRow {
  date: string;
  principal: number;
  /** 이번 회차 구간에 유지된 보유현금(KRW). 반기지급에서는 결제 후 현금잔액으로 고정 */
  cashBalance: number;
  /** 채권 쿠폰 이자만 (현금잔액 이자는 제외) */
  interest: number;
  /** 직전 지급일~이번 지급일 구간 보유현금(KRW)에 대한 단리 이자 */
  cashInterest: number;
  /** 채권 쿠폰 과세분 + 보유현금 이자 */
  taxableIncome: number;
  taxBase: number;
  /** 채권이자분 소득세(과세여부 기준) + 현금이자분 소득세(15.4%) */
  incomeTax: number;
  netAmount: number;
  /**
   * 만기 회차에 한해, 투자자가 그날 실제로 지급받는 총액(원금상환 + 마지막
   * 쿠폰·현금이자 세후 + 반환 보유현금 − 만기청산 후취보수). 월지급표의
   * 만기상환 행처럼 "만기 때 지급되는 금액"을 그대로 보여주기 위한 표시용 값이다.
   * 수익률·요약 계산은 계속 netAmount/principal 을 따로 쓴다(중복 반영 방지).
   */
  maturityPayout?: number;
  /**
   * 첫 이표 회차에 되돌려받는, 매수 시 선지급한 경과이자(음수). "원금" 열에
   * 괄호로 표시하는 용도의 표시값이다(월지급표의 원금 차감분과 동일 취급).
   * 이미 interest/netAmount 에 반영돼 있으므로 요약·수익률 계산에는 쓰지 않는다.
   */
  principalReturn?: number;
}

const TRUST_MATURITY_LEAD_DAYS = 11;

export interface CashFlowScheduleInputs {
  maturityDate: string;
  couponRate: string;
  couponFrequency: CouponFrequency;
  purchaseYield: string;
  calcBasis: CalcBasis;
  trustContractDate: string;
  recentCouponDate: string;
  tradeCurrency: Currency;
  custodyCurrency: Currency;
  purchaseFxRate: string;
  maturityFxRate: string;
  trustInvestmentAmount: string;
  frontFeeRate: string;
  backFeeRate: string;
  cashInterestRate: string;
  taxStatus: TaxStatus;
}

function daysBetween(a: Date, b: Date): number {
  const MS_PER_DAY = 1000 * 60 * 60 * 24;
  return Math.round((b.getTime() - a.getTime()) / MS_PER_DAY);
}

/** 이자계산일별 현금흐름(원금/보유현금/채권이자/현금이자/과세소득/과세표준/소득세/세후수령액) 계산 */
export function generateFixCashFlow(
  input: CashFlowScheduleInputs
): CashFlowRow[] | null {
  const pricing = computeBondPricing(input);
  if (!pricing) return null;

  const maturity = new Date(input.maturityDate);
  const contractDate = new Date(input.trustContractDate);
  if (Number.isNaN(maturity.getTime()) || Number.isNaN(contractDate.getTime()))
    return null;

  const rate = Number(input.couponRate) / 100;
  const backFeeRate = Number(input.backFeeRate);
  if (Number.isNaN(backFeeRate)) return null;

  const needsFx = input.tradeCurrency !== input.custodyCurrency;
  const maturityFxRate = needsFx ? Number(input.maturityFxRate) : 1;
  if (needsFx && (!maturityFxRate || Number.isNaN(maturityFxRate) || maturityFxRate <= 0)) {
    return null;
  }
  const months = FREQUENCY_MONTHS[input.couponFrequency];
  const freqPerYear = 12 / months;
  const trustInvestmentAmount = Number(input.trustInvestmentAmount);
  const frontFeeAmount = Math.trunc(
    trustInvestmentAmount * (Number(input.frontFeeRate) / 100)
  );
  const cashInterestRate = Number(input.cashInterestRate) || 0;

  // 이자계산일 목록: 결제일 이후 첫 이표일부터 만기일까지 (만기일 그대로 마지막 원금상환일)
  const dates: Date[] = [];
  let cursor = new Date(pricing.recentCouponDate);
  cursor = addMonths(cursor, months);
  while (cursor <= maturity) {
    dates.push(cursor);
    if (toTime(cursor) === toTime(maturity)) break;
    cursor = addMonths(cursor, months);
  }
  if (dates.length === 0) return null;

  // 브라질 국채(Business/252)는 표면금리를 단순 나눗셈이 아니라 복리로 환산한
  // 반기 실효쿠폰을 지급한다(예: 연 10% -> 반기 4.880885%). 블룸버그 실제 값과
  // 대조해 확인함(computeBrazilDirtyPrice 참고).
  const couponAmount = roundDown(
    input.calcBasis === "Business/252"
      ? pricing.faceValue * (Math.pow(1 + rate, 1 / freqPerYear) - 1)
      : (rate * pricing.faceValue) / freqPerYear,
    2
  ) * maturityFxRate;

  // 화면에 보이는 현금흐름표 각 열(원금/보유현금/채권이자/현금이자/과세소득/
  // 과세표준/소득세/세후수령액)은 수탁통화가 KRW면 정수로, 그 외는 소수점
  // 2자리까지 절사해 표시한다. 절사 전 값을 그대로 내부 계산에 쓰면
  // "채권이자+현금이자-소득세=세후수령액" 같은 검산이 화면상 어긋나 보이므로,
  // 표시값과 동일하게 절사한 값을 각 행에 저장하고 그 절사값으로 이어간다.
  const isKrw = input.custodyCurrency === "KRW";
  const truncByCurrency = (n: number) => (isKrw ? Math.trunc(n) : roundDown(n, 2));

  const rows: CashFlowRow[] = [];
  let periodStart = contractDate;
  let carryFrontFee = frontFeeAmount;
  let carryBackFeeResidual = 0;
  // 후취보수 계산 기준: 신탁투자원금. 첫 이표 회차에 매수 시 선지급한 경과이자를
  // 돌려받으면 그만큼 원금이 줄어들어, 이후 회차는 줄어든 원금으로 후취보수를 뗀다.
  let principalBase = trustInvestmentAmount;
  // 결제 후 신탁 내 보유현금. 반기지급에서는 쿠폰·현금이자가 매 회차 그대로
  // 투자자에게 지급돼(전기와 당기간 발생분은 당기 지급) 남는 금액이 없으므로
  // 만기까지 불변이다. 월 지급 단계에서는 부분지급 잔액이 회차마다 합산된다.
  const runningCashBalance = pricing.cashBalance;

  dates.forEach((date, index) => {
    const isMaturity = toTime(date) === toTime(maturity);
    const principal = truncByCurrency(isMaturity ? pricing.faceValue * maturityFxRate : 0);
    const interest = truncByCurrency(couponAmount);

    // 직전 지급일~이번 지급일 구간 보유현금 단리 이자 (신탁계약일 기산, 만기일 종료)
    const cashInterest = truncByCurrency(
      (runningCashBalance * (cashInterestRate / 100) / 365) *
        daysBetween(periodStart, date)
    );

    // couponAmount(이번 회차 이자, 브라질은 복리환산 쿠폰)와 같은 기준으로
    // 경과분을 계산해야 "이자-경과이자"가 일치한다. 별도로 단순금리(rate)를
    // 다시 곱해 계산하면 브라질처럼 쿠폰이 복리환산인 경우 어긋난다.
    const preOwnedInterest =
      index === 0 ? couponAmount * pricing.accrualFraction * freqPerYear : 0;
    const bondTaxableIncome =
      index === 0
        ? truncByCurrency(couponAmount - preOwnedInterest)
        : interest;
    const taxableIncome = bondTaxableIncome + cashInterest;

    const availableFrontFee = carryFrontFee;
    const backFeeThisPeriod =
      (principalBase * (backFeeRate / 100) / 365) *
      daysBetween(periodStart, date);
    const availableBackFee = carryBackFeeResidual + backFeeThisPeriod;
    const totalDeduction = availableFrontFee + availableBackFee;

    // 채권이자는 비과세인 경우가 많으므로 선취/후취보수 공제를 현금이자 과세분에
    // 먼저 적용하고, 남는 공제만 채권이자 과세분에서 차감한다.
    const cashTaxBase = Math.max(0, cashInterest - totalDeduction);
    const deductionLeftover = Math.max(0, totalDeduction - cashInterest);
    const bondTaxRate = getEffectiveIncomeTaxRate(input.taxStatus);
    // 비과세 채권이자는 과세표준에 들어가지 않는다.
    const bondTaxBase =
      bondTaxRate > 0 ? Math.max(0, bondTaxableIncome - deductionLeftover) : 0;
    const taxBase = truncByCurrency(bondTaxBase + cashTaxBase);

    const incomeTaxRaw =
      bondTaxBase * bondTaxRate + cashTaxBase * CASH_INTEREST_TAX_RATE;
    const incomeTax = isKrw
      ? roundDown(incomeTaxRaw, -1)
      : roundDown(incomeTaxRaw, 2);
    const netAmount = truncByCurrency(
      interest + cashInterest - backFeeThisPeriod - incomeTax
    );

    // 만기 회차: 월지급표처럼 "그날 실제 지급받는 총액"을 표시용으로 계산.
    // 원금상환 + 세후 쿠폰·현금이자(netAmount) + 반환 보유현금 − 만기청산 후취보수.
    let maturityPayout: number | undefined;
    if (isMaturity) {
      const lastBackFee =
        (principalBase * (backFeeRate / 100) / 365) * TRUST_MATURITY_LEAD_DAYS;
      maturityPayout = truncByCurrency(
        principal + netAmount + runningCashBalance - lastBackFee
      );
    }

    rows.push({
      date: date.toISOString().slice(0, 10),
      principal,
      cashBalance: truncByCurrency(runningCashBalance),
      interest,
      cashInterest,
      taxableIncome,
      taxBase,
      incomeTax,
      netAmount,
      maturityPayout,
      principalReturn:
        index === 0 && preOwnedInterest > 0
          ? -truncByCurrency(preOwnedInterest)
          : undefined,
    });

    // 공제는 "실제 과세되는 소득"만큼만 소진된다. 비과세 채권이자는 아무리 커도
    // 공제를 갉아먹지 않으므로, 소진액 계산에서 제외한다(선취보수가 첫 회차에
    // 통째로 소각되던 문제).
    const taxedThisPeriod =
      cashInterest + (bondTaxRate > 0 ? bondTaxableIncome : 0);
    const deductionUsed = Math.min(totalDeduction, taxedThisPeriod);
    const frontUsed = Math.min(availableFrontFee, deductionUsed);
    carryFrontFee = availableFrontFee - frontUsed;
    carryBackFeeResidual = availableBackFee - (deductionUsed - frontUsed);
    periodStart = date;

    // 첫 이표 회차에서 경과이자를 돌려받았으므로 다음 회차부터 후취보수 기준 원금을 줄인다
    if (index === 0) principalBase -= preOwnedInterest;
  });

  return rows;
}

function toTime(date: Date): number {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}
