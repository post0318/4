/**
 * 한국브라질소사이어티(KOBRAS, https://www.kobras.or.kr/)가 네이버 블로그
 * "글로벌 시대의 다리"(dari0202)에 매일 올리는 「브라질 데일리 리포트」를 가져온다.
 *
 * - RSS(https://rss.blog.naver.com/dari0202.xml)에서 "브라질정보자료" 카테고리의
 *   최신 데일리 리포트 글을 찾고,
 * - 본문(PostView)에서 [KOBRAS Daily Brief](핵심 분석) 섹션만 뽑는다.
 *   (기사모음·시장현황 섹션은 링크가 없어 제외)
 *
 * 이미 한글이라 번역은 하지 않는다. 원문 링크·출처를 화면에 함께 노출한다
 * (블로그 저작권 표시: 저작자 명시·비영리·변경 금지).
 */

const BLOG_ID = "dari0202";
const RSS_URL = `https://rss.blog.naver.com/${BLOG_ID}.xml`;
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

export interface KobrasBriefTopic {
  /** 소제목(출처·날짜 포함) */
  headline: string;
  /** • 로 시작하던 세부 불릿 */
  bullets: string[];
  /** *주: 로 시작하던 편집자 주석 */
  notes: string[];
}

export interface KobrasDailyReport {
  title: string;
  /** 글 발행 시각(ISO) */
  publishedAt: string;
  /** 네이버 블로그 원문 링크 */
  link: string;
  /** 큐레이션 출처(한국브라질소사이어티) */
  sourceName: string;
  sourceUrl: string;
  brief: KobrasBriefTopic[];
  /** 본문 파싱에 실패해 RSS 요약만 담았는지 여부 */
  partial: boolean;
}

function decodeEntities(s: string): string {
  return s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#(?:x3D|X3D);/g, "=")
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCharCode(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

function tag(name: string, xml: string): string | null {
  const m = xml.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`, "i"));
  return m ? decodeEntities(m[1]).trim() : null;
}

const REPORT_TITLE = /데일리\s*리포트/;

interface RssHit {
  title: string;
  link: string;
  logNo: string;
  publishedAt: string;
}

async function findLatestReport(): Promise<RssHit | null> {
  const res = await fetch(RSS_URL, {
    headers: { "user-agent": UA },
    next: { revalidate: 3600 },
  });
  if (!res.ok) return null;
  const xml = await res.text();
  const blocks = xml.match(/<item>[\s\S]*?<\/item>/gi) ?? [];
  for (const b of blocks) {
    const category = tag("category", b) ?? "";
    const title = tag("title", b) ?? "";
    if (!category.includes("브라질정보자료") || !REPORT_TITLE.test(title)) {
      continue;
    }
    const rawLink = tag("link", b) ?? tag("guid", b) ?? "";
    const logNo = rawLink.match(/\/(\d{6,})/)?.[1];
    if (!logNo) continue;
    const pub = tag("pubDate", b);
    const d = pub ? new Date(pub) : null;
    return {
      title,
      link: `https://blog.naver.com/${BLOG_ID}/${logNo}`,
      logNo,
      publishedAt:
        d && !Number.isNaN(d.getTime())
          ? d.toISOString()
          : new Date().toISOString(),
    };
  }
  return null;
}

/** PostView HTML → 본문 텍스트 줄 배열(UI 잡음 제거 전까지) */
function extractLines(html: string): string[] {
  let h = html.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, "");
  const main = h.match(/se-main-container([\s\S]*)/i);
  if (main) h = main[1];
  h = h.replace(/<[^>]+>/g, "\n");
  h = decodeEntities(h).replace(/​/g, "");
  const lines = h
    .split("\n")
    .map((x) => x.replace(/[ \t　]+/g, " ").trim())
    .filter(Boolean);
  // 본문 뒤 네이버 UI 영역 잘라내기
  const cut = lines.findIndex(
    (x) => x === "태그" || x.startsWith("[출처]") || x === "공감"
  );
  return cut >= 0 ? lines.slice(0, cut) : lines;
}

function sliceBetween(
  lines: string[],
  start: RegExp,
  end: RegExp
): string[] {
  const s = lines.findIndex((l) => start.test(l));
  if (s < 0) return [];
  const rest = lines.slice(s + 1);
  const e = rest.findIndex((l) => end.test(l));
  return e < 0 ? rest : rest.slice(0, e);
}

function parseBrief(lines: string[]): KobrasBriefTopic[] {
  const topics: KobrasBriefTopic[] = [];
  let cur: KobrasBriefTopic | null = null;
  for (const line of lines) {
    if (/^[•·]/.test(line)) {
      if (!cur) cur = { headline: "", bullets: [], notes: [] };
      cur.bullets.push(line.replace(/^[•·]\s*/, ""));
    } else if (/^[*※]/.test(line)) {
      if (!cur) cur = { headline: "", bullets: [], notes: [] };
      cur.notes.push(line.replace(/^[*※]\s*/, ""));
    } else {
      if (cur) topics.push(cur);
      cur = { headline: line, bullets: [], notes: [] };
    }
  }
  if (cur) topics.push(cur);
  return topics.filter((t) => t.headline || t.bullets.length);
}

export async function fetchKobrasDailyReport(): Promise<KobrasDailyReport | null> {
  const hit = await findLatestReport().catch(() => null);
  if (!hit) return null;

  const base: KobrasDailyReport = {
    title: hit.title,
    publishedAt: hit.publishedAt,
    link: hit.link,
    sourceName: "한국브라질소사이어티(KOBRAS)",
    sourceUrl: "https://www.kobras.or.kr/",
    brief: [],
    partial: true,
  };

  try {
    const res = await fetch(
      `https://blog.naver.com/PostView.naver?blogId=${BLOG_ID}&logNo=${hit.logNo}`,
      { headers: { "user-agent": UA }, next: { revalidate: 3600 } }
    );
    if (!res.ok) return base;
    const lines = extractLines(await res.text());

    const briefLines = sliceBetween(
      lines,
      /KOBRAS Daily Brief/i,
      /^\[?BRAZIL 시장 현황|^\[브라질 관련 기사모음/
    );

    const brief = parseBrief(briefLines);
    if (brief.length === 0) return base;
    return { ...base, brief, partial: false };
  } catch {
    return base;
  }
}
