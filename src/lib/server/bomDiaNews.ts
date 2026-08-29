/**
 * 좋은아침뉴스(bomdianews.com.br) — 상파울루 한인신문. 브라질 현지 뉴스를 한국어로
 * 직접 취재·번역해 싣는다. "브라질뉴스" 카테고리 WordPress RSS를 그대로 읽는다
 * (자동 번역·왕복검증 불필요).
 *
 * ModSecurity가 기본 UA를 막으므로 브라우저 UA로 요청한다.
 */

const FEED_URL = "https://bomdianews.com.br/category/brazilnews/feed/";
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

export interface LocalNewsItem {
  title: string;
  link: string;
  summary: string;
  publishedAt: string;
  source: string;
}

function decode(s: string): string {
  return s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/<[^>]+>/g, "")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#8211;/g, "–")
    .replace(/&#8217;|&#8216;/g, "'")
    .replace(/&#8220;|&#8221;/g, '"')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}

function tag(name: string, xml: string): string | null {
  const m = xml.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`, "i"));
  return m ? decode(m[1]) : null;
}

/** 본문 앞머리의 정형 문구(오디오 안내, "[좋은아침]" 표식) 제거 후 발췌 */
function cleanSummary(raw: string, maxLen = 140): string {
  let s = raw;
  const mark = s.indexOf("[좋은아침]");
  if (mark >= 0) s = s.slice(mark + "[좋은아침]".length);
  s = s.replace(/^\s*[-–·]\s*/, "").trim();
  if (s.length > maxLen) s = s.slice(0, maxLen).replace(/\s+\S*$/, "") + "…";
  return s;
}

/**
 * 국채(헤알 금리·환율) 판단에 영향을 줄 만한 주제만 통과시키는 허용목록.
 * 블록목록으로 잡음을 하나씩 거르는 대신, 관련 있는 글만 남긴다.
 * 항목이 부족하면 5건 미만이 될 수 있다(의도된 동작).
 */
const RELEVANT =
  /금리|기준금리|Selic|셀릭|Copom|코팜|헤알|환율|외환|국채|채권|국가?부채|공공부채|재정|적자|흑자|세제|세금|조세|증세|감세|IBS|CBS|심플레스|물가|인플레|디플레|중앙은행|통화정책|증시|주가|Ibovespa|보베스파|경제성장|경기|GDP|성장률|실업|고용|일자리|인건비|임금|노동개혁|6\s*[×xX]\s*1|소비자\s*신뢰|소비심리|소비자신뢰지수|소비지출|민간소비|소매판매|산업생산|기업신뢰|경기신뢰|FGV|무역|교역|수출|수입|관세|외국인\s*투자|신용등급|국가\s*신용|S&P|피치|무디스|Fitch|Moody|룰라\s*정부|하원|상원|연방대법원|STF|대선|탄핵|재정개혁|연금개혁|세제개편|예산안|Petrobras|페트로브라스|Vale|철광석|유가|국제유가|경제부|재무부/i;

export async function fetchBomDiaNews(limit = 5): Promise<LocalNewsItem[]> {
  try {
    const res = await fetch(FEED_URL, {
      headers: { "user-agent": UA, accept: "application/rss+xml, application/xml" },
      next: { revalidate: 1800 },
    });
    if (!res.ok) return [];
    const xml = await res.text();
    const blocks = xml.match(/<item>[\s\S]*?<\/item>/gi) ?? [];
    const all: LocalNewsItem[] = [];
    for (const b of blocks) {
      const title = tag("title", b);
      const link = tag("link", b);
      if (!title || !link) continue;
      const pub = tag("pubDate", b);
      const d = pub ? new Date(pub) : null;
      all.push({
        title,
        link,
        summary: cleanSummary(tag("description", b) ?? ""),
        publishedAt:
          d && !Number.isNaN(d.getTime())
            ? d.toISOString()
            : new Date().toISOString(),
        source: "좋은아침뉴스",
      });
    }
    // 국채·환율 판단에 관련된 글만 남긴다(최신순). 관련 글이 없으면 빈 배열.
    return all
      .filter((it) => RELEVANT.test(it.title) || RELEVANT.test(it.summary))
      .slice(0, limit);
  } catch {
    return [];
  }
}
