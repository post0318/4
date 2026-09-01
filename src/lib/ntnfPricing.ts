import {
  brazilBusinessDaysBetween,
  isBrazilBusinessDay,
} from "@/lib/brazilCalendar";

/**
 * NTN-F 매수단가(PU) 계산 — ANBIMA 표준 공식.
 *
 * 프로젝트 3(브라질국채 신탁 계산기)의 `computeBrazilDirtyPrice`를 NTN-F 전용으로
 * 추려온 것이다. 미국식 PRICE() 공식과 다르게, 표면금리(연 10%)를 반기 복리로
 * 환산한 실효쿠폰(1,000 * ((1.10)^(1/2) - 1) ≈ 48.8088)을 6개월마다 지급하고,
 * 결제일부터 각 현금흐름까지의 브라질 영업일수(Business/252, DU = 결제일 포함 ~
 * 현금흐름일 제외)를 지수로 한 복리로 할인한다: PU = Σ CF / (1 + 수익률)^(DU/252).
 * (DU 컨벤션을 [S,C)로 맞춰 Tesouro 공시 PU와 0.001% 이내 일치 — 2026-09 감사.)
 */

/** NTN-F 고정 파라미터 — 테조우로 나시오나우가 전 NTN-F를 아래 값으로 발행한다
 *  (상품 정의상 불변, 종목·회차별로 달라지지 않음). */
const ANNUAL_COUPON_RATE = 0.1; // 표면이율 연 10% (정의상 고정)
const PERIODS_PER_YEAR = 2; // 6개월(반기) 지급
const FACE = 1000; // 액면·상환가액 (per título)
const BUSINESS_DAYS_PER_YEAR = 252;

function addMonths(date: Date, months: number): Date {
  const result = new Date(date);
  result.setMonth(result.getMonth() + months);
  return result;
}

function addDays(date: Date, days: number): Date {
  const result = new Date(date);
  result.setDate(result.getDate() + days);
  return result;
}

/** "YYYY-MM-DD" → 로컬 자정 Date (UTC 파싱으로 인한 하루 밀림 방지) */
export function parseLocalDate(iso: string): Date | null {
  const m = iso.trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  const year = Number(m[1]);
  // date input에 직접 타이핑하면 연도가 한 자리씩 채워지며 "0002"·"0202"
  // 같은 미완성 값이 onChange로 흘러든다. 이 경우 결제일이 1902년(JS의 2자리
  // 연도 규칙) 또는 서기 202년이 되어, 만기까지의 브라질 영업일수를 하루씩
  // 걷는 루프가 수백만 회 돌며 탭이 멈춘다. 현실적 범위만 통과시킨다.
  // (하한은 cashflow의 isPlausibleYear와 동일하게 1990.)
  if (year < 1990 || year > 2200) return null;
  const d = new Date(year, Number(m[2]) - 1, Number(m[3]));
  return Number.isNaN(d.getTime()) ? null : d;
}

/** 오늘(로컬) 자정 */
export function today(): Date {
  const n = new Date();
  return new Date(n.getFullYear(), n.getMonth(), n.getDate());
}

export function toISODate(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/**
 * 결제일. 브라질 국채는 SELIC 결제 관례대로 D+0 — 주문일이 브라질 영업일
 * (토/일 + ANBIMA/B3 국경일 제외)이면 그날, 아니면 다음 영업일.
 */
export function getOrderSettlementDate(orderDate: Date = today()): Date {
  let date = new Date(orderDate);
  while (!isBrazilBusinessDay(date)) date = addDays(date, 1);
  return date;
}

/** 결제일 이후 다음 이표일(1/1·7/1)부터 만기까지의 명목상 이표일 목록 */
function couponDates(settlement: Date, maturity: Date): Date[] {
  const dates: Date[] = [];
  let cursor = new Date(maturity);
  while (cursor > settlement) {
    dates.unshift(new Date(cursor));
    cursor = addMonths(cursor, -(12 / PERIODS_PER_YEAR));
  }
  return dates;
}

function roundUp(value: number, digits: number): number {
  const factor = Math.pow(10, digits);
  return Math.ceil(value * factor) / factor;
}

/**
 * NTN-F 매수단가(PU, per 1,000 face = per título, dirty price).
 * @param maturityDate "YYYY-MM-DD"
 * @param buyYieldPct  매수수익률 (연, %). 예: 14.53
 * @param settlement   결제일 (기본: D+0 브라질 영업일)
 */
export function computeNtnfPu(
  maturityDate: string,
  buyYieldPct: number,
  settlement: Date = getOrderSettlementDate()
): number | null {
  const maturity = parseLocalDate(maturityDate);
  if (!maturity) return null;
  if (settlement >= maturity) return null;
  if (!Number.isFinite(buyYieldPct)) return null;

  const yld = buyYieldPct / 100;
  const coupon =
    FACE * (Math.pow(1 + ANNUAL_COUPON_RATE, 1 / PERIODS_PER_YEAR) - 1);

  const dates = couponDates(settlement, maturity);
  if (dates.length === 0) return null;

  let pv = 0;
  for (const date of dates) {
    const isMaturity = date.getTime() === maturity.getTime();
    const cashFlow = coupon + (isMaturity ? FACE : 0);
    const businessDays = brazilBusinessDaysBetween(settlement, date);
    pv += cashFlow / Math.pow(1 + yld, businessDays / BUSINESS_DAYS_PER_YEAR);
  }

  return roundUp(pv, 4);
}
