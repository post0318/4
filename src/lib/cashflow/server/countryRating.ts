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
  const html = await res.text();

  const table = new Map<string, CountryRating>();
  const rowRe = /<a[^>]*href="\/([a-z-]+)\/rating"[^>]*>.*?<\/a>([\s\S]*?)<\/tr>/g;
  let row: RegExpExecArray | null;
  while ((row = rowRe.exec(html))) {
    const slug = row[1];
    const cellsHtml = row[2];
    const cellRe = /<td[^>]*>([\s\S]*?)<\/td>/g;
    const cells: string[] = [];
    let cell: RegExpExecArray | null;
    while ((cell = cellRe.exec(cellsHtml))) {
      const text = cell[1]
        .replace(/<[^>]+>/g, "")
        .replace(/&amp;/g, "&")
        .replace(/&#x27;/g, "'")
        .trim();
      cells.push(text);
    }
    const [sp, moodys, dbrs] = cells;
    table.set(slug, {
      sp: sp || null,
      moodys: moodys || null,
      dbrs: dbrs || null,
    });
  }

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
