/**
 * 월지급 지급일(매월 10일) 계산에 쓰는 한국 영업일 캘린더.
 * 양력 고정공휴일 + 음력 명절(설날·부처님오신날·추석, KASI 발표 양력날짜 하드코딩)
 * + 대체공휴일 규칙(「공휴일에 관한 법률 시행령」 제3조)까지 반영한다.
 * 임시공휴일·선거일은 예측 불가라 미반영.
 *
 * 대체공휴일: 설날·추석 연휴는 일요일 또는 다른 공휴일과 겹칠 때만(토요일 제외),
 * 3·1절·광복절·개천절·한글날·어린이날·부처님오신날·성탄절은 토·일 또는 다른
 * 공휴일과 겹칠 때. 신정·현충일은 대상 아님.
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

function koreaHolidaysOfYear(year: number): Set<string> {
  const cached = holidayCache.get(year);
  if (cached) return cached;

  const baseList = baseHolidays(year);
  const counts = new Map<string, number>();
  for (const d of baseList) {
    counts.set(dateKey(d), (counts.get(dateKey(d)) ?? 0) + 1);
  }
  const set = new Set(counts.keys());
  // 같은 날에 공휴일이 둘 이상(예: 어린이날·부처님오신날) 겹치면 대체 대상
  const overlapsOtherHoliday = (d: Date) => (counts.get(dateKey(d)) ?? 0) > 1;

  // 대체공휴일 (「공휴일에 관한 법률 시행령」 제3조). 겹침이 있으면 그 연휴의
  // 마지막 날 다음의 첫 "비공휴일 평일" 하나를 추가한다. 신정·현충일은 대상 아님.
  // - 설날·추석 연휴: 일요일 또는 다른 공휴일과 겹칠 때 (토요일은 제외 — 이미 3일 연휴)
  // - 그 외(3·1절·광복절·개천절·한글날·어린이날·부처님오신날·성탄절):
  //   토요일·일요일 또는 다른 공휴일과 겹칠 때
  const rollFrom: Date[] = [];
  const lunar = LUNAR_HOLIDAYS[year];
  if (lunar) {
    const [seol, buddha, chuseok] = lunar.map(ymd);
    for (const anchor of [seol, chuseok]) {
      const trio = [addDays(anchor, -1), anchor, addDays(anchor, 1)];
      if (trio.some((d) => d.getDay() === 0 || overlapsOtherHoliday(d))) {
        rollFrom.push(addDays(anchor, 1));
      }
    }
    if (isWeekend(buddha) || overlapsOtherHoliday(buddha)) rollFrom.push(buddha);
  }
  for (const [m, d] of [
    [2, 1], // 삼일절
    [4, 5], // 어린이날
    [7, 15], // 광복절
    [9, 3], // 개천절
    [9, 9], // 한글날
    [11, 25], // 성탄절
  ] as const) {
    const date = new Date(year, m, d);
    if (isWeekend(date) || overlapsOtherHoliday(date)) rollFrom.push(date);
  }

  const rolled = new Set<string>();
  for (const start of rollFrom) {
    if (rolled.has(dateKey(start))) continue; // 같은 날 두 공휴일 → 대체 1일
    rolled.add(dateKey(start));
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
 *
 * 반환값은 UTC 자정 기준으로 맞춘다. 다른 날짜(결제일 등)가 "YYYY-MM-DD" 문자열
 * 파싱으로 만들어져 UTC 자정인데, 여기서 로컬 자정 Date를 돌려주면 toISOString()
 * 직렬화 시 KST 등 UTC+ 환경에서 하루가 당겨져 표시·일수계산이 어긋난다.
 */
export function koreaPaymentDate(year: number, month: number): Date {
  let d = new Date(year, month, 10);
  while (!isKoreaBusinessDay(d)) d = addDays(d, 1);
  return new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
}
