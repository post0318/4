const RATING_LIST_URL = "https://tradingeconomics.com/country-list/rating";
const CACHE_TTL_MS = 12 * 60 * 60 * 1000;

export interface CountryRating {
  sp: string | null;
  moodys: string | null;
  dbrs: string | null;
}

let cache: { at: number; table: Map<string, CountryRating> } | null = null;

/**
 * tradingeconomics.com/country-list/rating은 국가별 S&P/Moody's/DBRS 국가신용등급을
 * 정적 HTML 테이블로 제공한다(로그인·서비스키 불필요, 반복 요청도 차단되지 않음을
 * 확인했다). 국채(국고채권/미국국채 등)의 신용등급을 발행국 국가신용등급으로
 * 자동 반영하는 데 사용한다(신용등급 필드에는 S&P/Moody's만 반영하고 DBRS는
 * 표시하지 않는다). 표 전체를 한 번에 받아 국가 슬러그(href의 "/{slug}/rating")
 * 별로 파싱해 캐시한다(값이 자주 바뀌지 않아 12시간 캐시).
 */
async function fetchTable(): Promise<Map<string, CountryRating>> {
  if (cache && Date.now() - cache.at < CACHE_TTL_MS) return cache.table;

  const res = await fetch(RATING_LIST_URL, {
    headers: { "User-Agent": "Mozilla/5.0" },
  });
  if (!res.ok) throw new Error(`tradingeconomics.com 요청 실패 (${res.status})`);

  // 페이지에는 국가별 등급이 이스케이프된 JSON으로 임베드돼 있다:
  // {"country":"Brazil","url":"/brazil/rating","S&P":"BB","Moody's":"Ba1","DBRS":"BB",...}
  // HTML 테이블 스크레이핑보다 안정적이라 이 JSON을 파싱한다.
  const html = (await res.text())
    .replace(/\\u0026/g, "&")
    .replace(/\\u0027/g, "'")
    .replace(/\\"/g, '"')
    .replace(/\\\//g, "/");

  const table = new Map<string, CountryRating>();
  const re =
    /"url":"\/([a-z-]+)\/rating"[^{}]*?"S&P":"([^"]*)"[^{}]*?"Moody's":"([^"]*)"(?:[^{}]*?"DBRS":"([^"]*)")?/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    const [, slug, sp, moodys, dbrs] = m;
    if (!table.has(slug)) {
      table.set(slug, {
        sp: sp || null,
        moodys: moodys || null,
        dbrs: dbrs || null,
      });
    }
  }

  if (table.size === 0) throw new Error("신용등급 표를 파싱하지 못했습니다.");

  cache = { at: Date.now(), table };
  return table;
}

/** slug 예: "south-korea", "united-states" (tradingeconomics.com URL 경로 기준) */
export async function fetchCountryRating(slug: string): Promise<CountryRating | null> {
  const table = await fetchTable();
  return table.get(slug) ?? null;
}

export function formatCountryRating(rating: CountryRating): string | null {
  const parts: string[] = [];
  if (rating.sp) parts.push(`S&P ${rating.sp}`);
  if (rating.moodys) parts.push(`Moody's ${rating.moodys}`);
  return parts.length > 0 ? parts.join(" / ") : null;
}
