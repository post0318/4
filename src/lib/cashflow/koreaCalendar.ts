/**
 * 월지급 지급일(매월 10일) 계산에 쓰는 한국 영업일 캘린더.
 * 양력 고정공휴일 + 음력 명절(설날·부처님오신날·추석, KASI 발표 양력날짜 하드코딩)
 * + 대체공휴일 규칙까지 반영한다. 임시공휴일·선거일은 예측 불가라 미반영.
 *
 * 음력 명절 표는 2025~2040년만 담는다(현행 NTN-F 최장물 만기 + 신탁 청산분 커버).
 * 범위 밖 연도는 명절을 건너뛰고 양력 공휴일만 적용한다.
 */

/** [설날 당일, 부처님오신날, 추석 당일] 양력 (YYYY-MM-DD). 설/추석은 ±1일이 연휴. */
const LUNAR_HOLIDAYS: Record<number, [string, string, string]> = {
  2025: ["2025-01-29", "2025-05-05", "2025-10-06"],
  2026: ["2026-02-17", "2026-05-24", "2026-09-25"],
  2027: ["2027-02-07", "2027-05-13", "2027-09-15"],
  2028: ["2028-01-27", "2028-05-02", "2028-10-03"],
  2029: ["2029-02-13", "2029-05-20", "2029-09-22"],
  2030: ["2030-02-03", "2030-05-09", "2030-09-12"],
  2031: ["2031-01-23", "2031-05-28", "2031-10-01"],
  2032: ["2032-02-11", "2032-05-16", "2032-09-19"],
  2033: ["2033-01-31", "2033-05-06", "2033-09-08"],
  2034: ["2034-02-19", "2034-05-25", "2034-09-28"],
  2035: ["2035-02-08", "2035-05-15", "2035-09-16"],
  2036: ["2036-01-28", "2036-05-03", "2036-10-04"],
  2037: ["2037-02-15", "2037-05-22", "2037-09-24"],
  2038: ["2038-02-04", "2038-05-11", "2038-09-13"],
  2039: ["2039-01-24", "2039-04-30", "2039-10-02"],
  2040: ["2040-02-12", "2040-05-18", "2040-09-21"],
};

function addDays(date: Date, days: number): Date {
  const r = new Date(date);
  r.setDate(r.getDate() + days);
  return r;
}

function dateKey(d: Date): string {
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

function ymd(iso: string): Date {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d);
}

function isWeekend(d: Date): boolean {
  const w = d.getDay();
  return w === 0 || w === 6;
}

const holidayCache = new Map<number, Set<string>>();

/** 대체공휴일 없이 그 해의 "본" 공휴일 날짜들 */
function baseHolidays(year: number): Date[] {
  const list: Date[] = [
    new Date(year, 0, 1), // 신정
    new Date(year, 2, 1), // 삼일절
    new Date(year, 4, 5), // 어린이날
    new Date(year, 5, 6), // 현충일
    new Date(year, 7, 15), // 광복절
    new Date(year, 9, 3), // 개천절
    new Date(year, 9, 9), // 한글날
    new Date(year, 11, 25), // 성탄절
  ];
  const lunar = LUNAR_HOLIDAYS[year];
  if (lunar) {
    const [seol, buddha, chuseok] = lunar.map(ymd);
    list.push(addDays(seol, -1), seol, addDays(seol, 1)); // 설 연휴 3일
    list.push(buddha);
    list.push(addDays(chuseok, -1), chuseok, addDays(chuseok, 1)); // 추석 연휴 3일
  }
  return list;
}

/** 대체공휴일 대상 공휴일(신정·현충일 제외). 설/추석/어린이날은 토요일도 대체 적용. */
function needsSubstitute(d: Date, satAlso: boolean): boolean {
  const w = d.getDay();
  return w === 0 || (satAlso && w === 6);
}

function koreaHolidaysOfYear(year: number): Set<string> {
  const cached = holidayCache.get(year);
  if (cached) return cached;

  const set = new Set(baseHolidays(year).map(dateKey));

  // 대체공휴일: 겹침(주말/타공휴일)이 있으면 그 연휴의 마지막 날 다음의
  // 첫 "비공휴일 평일"을 하나 추가한다.
  const rollFrom: Date[] = [];
  const lunar = LUNAR_HOLIDAYS[year];
  if (lunar) {
    const [seol, buddha, chuseok] = lunar.map(ymd);
    for (const anchor of [seol, chuseok]) {
      const trio = [addDays(anchor, -1), anchor, addDays(anchor, 1)];
      if (trio.some((d) => needsSubstitute(d, true))) rollFrom.push(addDays(anchor, 1));
    }
    if (needsSubstitute(buddha, false)) rollFrom.push(buddha);
  }
  for (const [m, d, satAlso] of [
    [2, 1, false], // 삼일절
    [4, 5, true], // 어린이날 (토요일도 대체)
    [7, 15, false], // 광복절
    [9, 3, false], // 개천절
    [9, 9, false], // 한글날
    [11, 25, false], // 성탄절
  ] as const) {
    const date = new Date(year, m, d);
    if (needsSubstitute(date, satAlso)) rollFrom.push(date);
  }

  for (const start of rollFrom) {
    let cur = addDays(start, 1);
    while (isWeekend(cur) || set.has(dateKey(cur))) cur = addDays(cur, 1);
    set.add(dateKey(cur));
  }

  holidayCache.set(year, set);
  return set;
}

export function isKoreaHoliday(date: Date): boolean {
  return koreaHolidaysOfYear(date.getFullYear()).has(dateKey(date));
}

export function isKoreaBusinessDay(date: Date): boolean {
  return !isWeekend(date) && !isKoreaHoliday(date);
}

/**
 * 지정한 연·월(0-based month)의 월지급일 = 그 달 10일, 한국 비영업일이면 다음 영업일.
 */
export function koreaPaymentDate(year: number, month: number): Date {
  let d = new Date(year, month, 10);
  while (!isKoreaBusinessDay(d)) d = addDays(d, 1);
  return d;
}
