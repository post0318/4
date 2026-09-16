import { CouponFrequency } from "@/lib/cashflow/bondLayout";
import { isBrazilBusinessDay, isPlausibleYear } from "@/lib/cashflow/brazilCalendar";

const TRUST_MATURITY_LEAD_DAYS = 11;

export const FREQUENCY_MONTHS: Record<CouponFrequency, number> = {
  "3개월": 3,
  "6개월": 6,
  "12개월": 12,
};

/** PRICE 함수의 frequency 인자(1/2/4)로 변환 */
export const FREQUENCY_PER_YEAR: Record<CouponFrequency, number> = {
  "12개월": 1,
  "6개월": 2,
  "3개월": 4,
};

export function addMonths(date: Date, months: number): Date {
  const result = new Date(date);
  result.setUTCMonth(result.getUTCMonth() + months);
  return result;
}

export function addDays(date: Date, days: number): Date {
  const result = new Date(date);
  result.setUTCDate(result.getUTCDate() + days);
  return result;
}

export function toDateString(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/**
 * 결제일 = 신탁계약일 기준 D+1 브라질 영업일 — 계약일 다음 날부터 세어 첫
 * 브라질 영업일(토/일 + ANBIMA/B3 국경일 제외). 트레이딩 탭의
 * `getOrderSettlementDate`와 같은 규칙(감사 ⑤ 높음1, 예전에는 D+0).
 */
export function getSettlementDate(trustContractDate: string): Date | null {
  const start = new Date(trustContractDate);
  if (!isPlausibleYear(start)) return null;

  let date = addDays(start, 1);
  while (!isBrazilBusinessDay(date)) date = addDays(date, 1);
  return date;
}

export interface CouponPeriod {
  previousCouponDate: Date;
  nextCouponDate: Date;
  /** 결제일부터 만기일까지 남은 이표 횟수 (COUPNUM) */
  periodsRemaining: number;
}

/** 만기일을 기준으로 이자지급주기만큼씩 거슬러 올라가, 기준일이 속한 이표기간(직전/차기 이표일)을 찾는다 */
export function getCouponPeriod(
  maturity: Date,
  frequency: CouponFrequency,
  referenceDate: Date
): CouponPeriod {
  const months = FREQUENCY_MONTHS[frequency];
  let nextCouponDate = maturity;
  let previousCouponDate = addMonths(nextCouponDate, -months);
  let periodsRemaining = 1;

  while (previousCouponDate > referenceDate) {
    nextCouponDate = previousCouponDate;
    previousCouponDate = addMonths(nextCouponDate, -months);
    periodsRemaining++;
  }

  return { previousCouponDate, nextCouponDate, periodsRemaining };
}

/**
 * 최근이표일 입력 검증 (감사 ⑤ 중4).
 * 최근이표일은 만기일에서 이자지급주기만큼 거슬러 올라온 격자 위에서, 결제일
 * 직전의 날짜 하나로 정해진다. 입력값이 그 자동값과 다르면(결제일 이후·격자 밖·
 * 회차 건너뜀) 경과이자와 쿠폰 회차가 조용히 틀어지므로 계산에는 자동값을 쓴다.
 *  - auto: 자동 계산값 (만기·계약일이 없으면 null)
 *  - valid: 입력이 비었거나 자동값과 같으면 true
 *  - effective: 계산에 쓸 값
 */
export function checkRecentCouponDate(
  maturityDate: string,
  frequency: CouponFrequency,
  trustContractDate: string,
  input: string
): { auto: string | null; valid: boolean; effective: string | null } {
  const maturity = new Date(maturityDate);
  const settlement = getSettlementDate(trustContractDate);
  if (!isPlausibleYear(maturity) || !settlement) {
    return { auto: null, valid: true, effective: input || null };
  }
  const auto = toDateString(getCouponPeriod(maturity, frequency, settlement).previousCouponDate);
  const valid = !input || input === auto;
  return { auto, valid, effective: auto };
}

export function getTrustMaturityDate(maturityDate: string): string | null {
  const maturity = new Date(maturityDate);
  if (Number.isNaN(maturity.getTime())) return null;
  return toDateString(addDays(maturity, TRUST_MATURITY_LEAD_DAYS));
}

const MS_PER_DAY = 1000 * 60 * 60 * 24;

/** 투자일수 = 신탁만기일 - 신탁계약일 (일) */
export function getInvestmentDays(
  trustContractDate: string,
  maturityDate: string
): number | null {
  const trustMaturity = getTrustMaturityDate(maturityDate);
  if (!trustMaturity) return null;

  const contract = new Date(trustContractDate);
  if (Number.isNaN(contract.getTime())) return null;

  const diff = new Date(trustMaturity).getTime() - contract.getTime();
  return Math.round(diff / MS_PER_DAY);
}

/** 최근이표일 = 만기일에서 이자지급주기만큼씩 거슬러 올라가 기준일(결제일) 이전인 가장 가까운 이표일 */
export function getRecentCouponDate(
  maturityDate: string,
  frequency: CouponFrequency,
  referenceDate: Date = new Date()
): string | null {
  const maturity = new Date(maturityDate);
  if (Number.isNaN(maturity.getTime())) return null;

  return toDateString(
    getCouponPeriod(maturity, frequency, referenceDate).previousCouponDate
  );
}

/** 이자계산일 목록. 신탁만기일(=만기일+11일)과 이자지급주기에 따라 행 수가 자동으로 변동한다. */
export function generateCouponSchedule(
  issueDate: string,
  maturityDate: string,
  frequency: CouponFrequency
): string[] {
  const issue = new Date(issueDate);
  const maturity = new Date(maturityDate);
  if (!isPlausibleYear(issue) || !isPlausibleYear(maturity) || maturity <= issue) {
    return [];
  }

  const months = FREQUENCY_MONTHS[frequency];
  const dates: string[] = [];
  let next = addMonths(issue, months);

  while (next < maturity) {
    dates.push(toDateString(next));
    next = addMonths(next, months);
  }

  dates.push(toDateString(addDays(maturity, TRUST_MATURITY_LEAD_DAYS)));

  return dates;
}
