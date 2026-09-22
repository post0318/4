/**
 * 재투자형 현금흐름 — 수령한 쿠폰(BRL)으로 같은 채권을 재매수한다.
 *
 * 가정:
 * - 재투자 시 매수금리 = 최초 매수금리(purchaseYield) 그대로.
 * - 정수 좌수(액면 R$1,000)만 매수하고, 남는 BRL은 그대로 보유해 다음 재투자에 쓴다.
 * - BRL 보유현금에는 현금성이자가 없다.
 * - 원화(KRW) 금액은 만기에 전액 회수할 때만 발생(중간 회차는 전부 BRL).
 * - 마지막 쿠폰은 재투자하지 않고 만기 상환액과 함께 수령.
 */

import { CalcBasis, CouponFrequency, TaxStatus } from "@/lib/cashflow/bondLayout";
import {
  FREQUENCY_MONTHS,
  FREQUENCY_PER_YEAR,
  addMonths,
  getInvestmentDays,
  getSettlementDate,
} from "@/lib/cashflow/couponSchedule";
import {
  anbimaCouponFactor,
  computeBondPricing,
  computePriceOn,
  roundDown,
} from "@/lib/cashflow/bondPricing";
import { parseIsoDate, toISODate } from "@/lib/ntnfPricing";
import { getEffectiveIncomeTaxRate } from "@/lib/cashflow/taxRules";

const FACE = 1000;

export interface ReinvestCashFlowRow {
  date: string;
  /** 이번 회차 직전 보유 좌수 */
  unitsBefore: number;
  /** 이번 회차 직전 보유 현금 (BRL) — 전기 재투자 후 남은 잔돈 */
  cashBrlBefore: number;
  /** 이번 회차 쿠폰 (BRL, per 전체 보유분) */
  couponBrl: number;
  /** 재매수 단가 (PU, R$) — 만기 회차는 상환가 1,000 */
  reinvestPu: number;
  /** 이번 회차 추가 매수 좌수 */
  unitsBought: number;
  /** 회차 반영 후 누적 보유 좌수 */
  unitsAfter: number;
  /** 재매수 후 남은 BRL 현금 */
  cashBrl: number;
  /** 만기 회차: 원화 회수액(원금상환 + 마지막 쿠폰 + 잔여현금, 세전, 후취보수 차감) */
  maturityKrw?: number;
}

export interface ReinvestCashFlowInputs {
  maturityDate: string;
  couponRate: string;
  couponFrequency: CouponFrequency;
  purchaseYield: string;
  calcBasis: CalcBasis;
  trustContractDate: string;
  recentCouponDate: string;
  tradeCurrency: string;
  custodyCurrency: string;
  purchaseFxRate: string;
  maturityFxRate: string;
  trustInvestmentAmount: string;
  frontFeeRate: string;
  backFeeRate: string;
  taxStatus: TaxStatus;
  /** 은행환산수익률용 종합소득세율(%) */
  comprehensiveTaxRate: string;
  /**
   * 신탁만기일 수기 지정(YYYY-MM-DD). 비우면 자동(만기일 + 리드타임 11일).
   * 지정하면 (지정일 − 만기일) 이 리드타임이 되어 투자일수·만기청산 후취보수·
   * 만기 구간 현금성이자에 모두 반영된다.
   */
  trustMaturityDate?: string;
  /**
   * 중도청산(갈아타기·중도해지). 넣으면 만기까지 가지 않고 이 날짜에 멈춰
   * 그때까지 불어난 좌수를 청산단가로 평가해 회수한다. 시뮬레이션 전용이며
   * 현금흐름 탭은 넣지 않아 결과가 그대로다(2026-09-17).
   */
  earlyExit?: {
    date: string;
    sellYieldPct: number;
    /** 청산 시점 환율. 비우면 만기예상환율 */
    fxRate?: number;
  };
}

export interface ReinvestExitResult {
  /** 청산 결제일 */
  date: string;
  /** 청산 시점 보유 좌수 (재투자로 불어난 결과) */
  units: number;
  /** 청산단가 (R$, per 좌) */
  pu: number;
  /** 청산 회수액 (수탁통화) — 좌수 평가액 + 잔여현금 − 청산까지의 후취보수 */
  recoveredKrw: number;
}

export interface ReinvestCashFlowSummary {
  /** 만기 보유 좌수 */
  finalUnits: number;
  /** 재투자로 늘어난 좌수 (만기 − 최초) */
  addedUnits: number;
  /** 수령 쿠폰 총액 (BRL, 재투자분 포함) */
  totalCouponBrl: number;
  /** 세전 만기 회수액 (KRW) */
  preTaxMaturityKrw: number;
  /** 세후 만기 회수액 (KRW) */
  postTaxMaturityKrw: number;
  /** 세후수익률 (단리, 365/투자일수) */
  postTaxYield: number;
  /**
   * 세후 복리수익률(CAGR) = (만기회수액/원금)^(365/투자일수) − 1.
   * 재투자형은 쿠폰이 신탁 안에 남아 채권을 다시 사므로 복리가 상품 안에서
   * 일어난다 → 가정 없이 계산된다. 단리 연환산은 만기 목돈을 연수로 나누는
   * 방식이라 연 수익률을 부풀려 보이게 해서, 둘을 같이 보여준다(감사 ⑤ 중5).
   * 반기·월지급형은 쿠폰이 출금돼 신탁을 떠나므로 복리수익률이 정의되지 않는다
   * (출금한 돈의 운용은 상품 밖의 일) → 그쪽에는 만들지 않는다.
   */
  postTaxCagr: number | null;
  bankEquivalentYield: number;
  /** 후취보수 산출: 신탁투자금액 × 요율 ÷ 365 × 투자일수 (만기 회수 시 차감) */
  backFee: {
    base: number; // 신탁투자금액 (KRW)
    ratePct: number; // 후취보수율 (%)
    days: number; // 투자일수
    amount: number; // 후취보수 금액 (KRW)
  };
}

export interface ReinvestCashFlowResult {
  rows: ReinvestCashFlowRow[];
  summary: ReinvestCashFlowSummary;
  /** 중도청산을 넣었을 때만 채워진다 (그때는 summary 의 만기값을 쓰지 않는다) */
  exit?: ReinvestExitResult;
  /** 최초 매수 좌수 */
  initialUnits: number;
  /** 최초 매수단가(PU, R$) */
  initialPu: number;
}

function toTime(d: Date): number {
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}

export function generateReinvestCashFlow(
  input: ReinvestCashFlowInputs
): ReinvestCashFlowResult | null {
  const pricing = computeBondPricing(input);
  if (!pricing) return null;

  const maturity = parseIsoDate(input.maturityDate);
  const settlement = parseIsoDate(pricing.settlementDate);
  if (!maturity || !settlement || settlement >= maturity) return null;

  const rate = Number(input.couponRate) / 100;
  const yld = Number(input.purchaseYield);
  const backFeeRate = Number(input.backFeeRate);
  const trustAmount = Number(input.trustInvestmentAmount);
  if (Number.isNaN(rate) || Number.isNaN(yld) || Number.isNaN(backFeeRate)) {
    return null;
  }

  const needsFx = input.tradeCurrency !== input.custodyCurrency;
  const maturityFx = needsFx ? Number(input.maturityFxRate) : 1;
  const purchaseFx = needsFx ? Number(input.purchaseFxRate) : 1;
  if (needsFx && (!maturityFx || Number.isNaN(maturityFx) || maturityFx <= 0)) {
    return null;
  }
  if (needsFx && (!purchaseFx || Number.isNaN(purchaseFx) || purchaseFx <= 0)) {
    return null;
  }

  const months = FREQUENCY_MONTHS[input.couponFrequency];
  const f = FREQUENCY_PER_YEAR[input.couponFrequency];
  const couponFactor =
    input.calcBasis === "Business/252"
      ? anbimaCouponFactor(rate, f)
      : rate / f;

  /**
   * 주어진 **결제일**의 매수단가(dirty) — 최초 매수와 같은 규칙
   * (`computePriceOn`: 입력 표면이율·이자지급주기·계산기준, 6자리 절사).
   */
  const puOn = (settleDate: Date, yieldPct = yld) =>
    computePriceOn(
      settleDate,
      maturity,
      Number(input.couponRate),
      yieldPct,
      input.couponFrequency,
      input.calcBasis,
      FACE
    )?.dirtyPrice ?? null;

  /**
   * 재매수 결제일 — 쿠폰을 받은 이표일에 주문해 D+1 브라질 영업일에
   * 결제한다. 최초 매수도 D+1 인데 재매수만 당일(D+0) 로 보던 것을
   * 맞춘다(하루 차이가 단가로 약 0.05%).
   */
  const reinvestSettle = (couponDate: Date) =>
    getSettlementDate(toISODate(couponDate));

  // 이표일: 결제일 이후 첫 이표일 ~ 만기 (날짜만 비교 — 시각차로 만기가 빠지지 않도록)
  const dates: Date[] = [];
  const recentCoupon =
    parseIsoDate(pricing.recentCouponDate) ??
    new Date(pricing.recentCouponDate);
  let cursor = addMonths(recentCoupon, months);
  while (toTime(cursor) <= toTime(maturity)) {
    dates.push(new Date(cursor));
    if (toTime(cursor) === toTime(maturity)) break;
    cursor = addMonths(cursor, months);
  }
  if (dates.length === 0) return null;

  // 중도청산: 청산 결제일까지만 재투자하고 그 시점 단가로 평가해 회수한다.
  const exitSettle = input.earlyExit
    ? getSettlementDate(input.earlyExit.date)
    : null;
  if (input.earlyExit && !exitSettle) return null;
  if (exitSettle) {
    if (toTime(exitSettle) <= toTime(settlement)) return null; // 매수 결제일 이전
    if (toTime(exitSettle) >= toTime(maturity)) return null; // 만기 이후면 만기보유
  }
  const scheduleDates = exitSettle
    ? dates.filter((d) => toTime(d) <= toTime(exitSettle))
    : dates;

  let units = Math.round(pricing.faceValue / FACE); // 최초 좌수
  const initialUnits = units;
  // 매수 후 남은 현금잔액(원화 표시)은 BRL로 전환해 첫 재투자 재원으로 쓴다.
  let cashBrl = needsFx ? pricing.cashBalance / purchaseFx : pricing.cashBalance;
  let totalCouponBrl = 0;
  const rows: ReinvestCashFlowRow[] = [];

  scheduleDates.forEach((date) => {
    const isMaturity = toTime(date) === toTime(maturity);
    const unitsBefore = units;
    const cashBrlBefore = cashBrl; // 이번 회차 쿠폰 반영 전 잔여현금
    const couponBrl = units * FACE * couponFactor;
    totalCouponBrl += couponBrl;

    if (isMaturity) {
      // 마지막 쿠폰 + 원금상환 + 잔여현금 → 원화 회수 (만기엔 재매수 없음)
      const redemptionBrl = units * FACE;
      const grossBrl = redemptionBrl + couponBrl + cashBrl;
      const days = getInvestmentDays(
      input.trustContractDate,
      input.maturityDate,
      input.trustMaturityDate
    ) ?? 0;
      const backFee =
        (trustAmount * (backFeeRate / 100) / 365) * days; // KRW, 전 기간 후취보수
      const maturityKrw = roundDown(grossBrl * maturityFx - backFee, 2);

      rows.push({
        date: toISODate(date),
        unitsBefore,
        cashBrlBefore: roundDown(cashBrlBefore, 2),
        couponBrl,
        reinvestPu: 0,
        unitsBought: 0,
        unitsAfter: units,
        cashBrl: 0,
        maturityKrw,
      });
      return;
    }

    // 재투자: 쿠폰 + 잔여현금으로 정수 좌수 매수 (매수금리 = 최초 그대로).
    // 단가는 최초 매수와 같은 규칙(`computePriceOn`) — 입력한 표면이율·
    // 이자지급주기·계산기준을 그대로 따른다.
    cashBrl += couponBrl;
    const settle = reinvestSettle(date);
    const pu = settle ? puOn(settle) : null;
    if (pu == null || pu <= 0) {
      rows.push({
        date: toISODate(date),
        unitsBefore,
        cashBrlBefore: roundDown(cashBrlBefore, 2),
        couponBrl,
        reinvestPu: 0,
        unitsBought: 0,
        unitsAfter: units,
        cashBrl: roundDown(cashBrl, 2),
      });
      return;
    }
    const bought = Math.floor(cashBrl / pu);
    cashBrl -= bought * pu;
    units += bought;

    rows.push({
      date: toISODate(date),
      unitsBefore,
      cashBrlBefore: roundDown(cashBrlBefore, 2),
      couponBrl,
      reinvestPu: pu,
      unitsBought: bought,
      unitsAfter: units,
      cashBrl: roundDown(cashBrl, 2),
    });
  });

  // 중도청산: 마지막 재투자까지 끝낸 좌수를 그 시점 단가로 평가해 회수한다.
  // 쿠폰이 전부 신탁 안에 남아 채권이 된 상태라 따로 지급된 돈이 없다.
  let exit: ReinvestExitResult | undefined;
  if (exitSettle && input.earlyExit) {
    const exitPu = puOn(exitSettle, Number(input.earlyExit.sellYieldPct));
    if (exitPu == null || exitPu <= 0) return null;
    const exitFx =
      needsFx && Number(input.earlyExit.fxRate) > 0
        ? Number(input.earlyExit.fxRate)
        : maturityFx;
    const grossBrl = units * exitPu + cashBrl;
    // 후취보수는 계약일 ~ 청산 결제일. 만기 리드타임은 붙지 않는다.
    const exitDays = Math.round(
      (toTime(exitSettle) - toTime(parseIsoDate(input.trustContractDate) ?? settlement)) /
        86400000
    );
    const exitBackFee = (trustAmount * (backFeeRate / 100) / 365) * exitDays;
    // 채권이자 과세분은 만기와 같은 규칙(재투자된 쿠폰도 과세소득이다)
    const exitTaxBrl = totalCouponBrl * getEffectiveIncomeTaxRate(input.taxStatus);
    exit = {
      date: toISODate(exitSettle),
      units,
      pu: exitPu,
      recoveredKrw: roundDown(
        (grossBrl - exitTaxBrl) * exitFx - exitBackFee,
        2
      ),
    };
  }

  const maturityRow = rows[rows.length - 1];
  const preTaxMaturityKrw = maturityRow.maturityKrw ?? 0;

  // 채권이자 과세분(일반과세면 14%). 브라질 국채이자는 비과세 조약이면 0.
  const bondTaxRate = getEffectiveIncomeTaxRate(input.taxStatus);
  const taxBrl = totalCouponBrl * bondTaxRate;
  const taxKrw = roundDown(taxBrl * maturityFx, 2);
  const postTaxMaturityKrw = roundDown(preTaxMaturityKrw - taxKrw, 2);

  const investmentDays =
    getInvestmentDays(
      input.trustContractDate,
      input.maturityDate,
      input.trustMaturityDate
    ) ?? 0;
  const backFeeAmount = roundDown(
    (trustAmount * (backFeeRate / 100) / 365) * investmentDays,
    2
  );
  const postTaxYield =
    investmentDays > 0
      ? ((postTaxMaturityKrw - trustAmount) / trustAmount) * (365 / investmentDays)
      : 0;

  const parsedComp = Number(input.comprehensiveTaxRate);
  const comprehensiveTaxRate =
    input.comprehensiveTaxRate && !Number.isNaN(parsedComp)
      ? parsedComp / 100
      : 0.154;

  return {
    rows,
    exit,
    initialUnits,
    initialPu: pricing.dirtyPrice,
    summary: {
      finalUnits: units,
      addedUnits: units - initialUnits,
      totalCouponBrl,
      preTaxMaturityKrw,
      postTaxMaturityKrw,
      postTaxYield,
      postTaxCagr:
        trustAmount > 0 && investmentDays > 0 && postTaxMaturityKrw > 0
          ? Math.pow(postTaxMaturityKrw / trustAmount, 365 / investmentDays) - 1
          : null,
      bankEquivalentYield: postTaxYield / (1 - comprehensiveTaxRate),
      backFee: {
        base: trustAmount,
        ratePct: backFeeRate,
        days: investmentDays,
        amount: backFeeAmount,
      },
    },
  };
}
