/**
 * 브라질 현지 뉴스(경제·정치·사회)를 G1(globo.com) RSS에서 모아, 제목을
 * MyMemory(무인증 무료 MT)로 pt→ko 번역해 반환한다. 번역 실패 시 원문을 쓴다.
 * 결과는 라우트에서 캐시(revalidate)하므로 MT 무료 한도 안에서 동작한다.
 */

import { translatePtToKo } from "@/lib/server/translate";

const FEEDS: { url: string; category: string }[] = [
  { url: "https://g1.globo.com/rss/g1/economia/", category: "경제" },
  { url: "https://g1.globo.com/rss/g1/politica/", category: "정치" },
  { url: "https://g1.globo.com/rss/g1/brasil/", category: "사회" },
];

export interface NewsItem {
  titleKo: string;
  titlePt: string;
  link: string;
  category: string;
  /** ISO */
  publishedAt: string;
  source: string;
}

function decodeEntities(s: string): string {
  return s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&amp;/g, "&")
    .trim();
}

function pick(tag: string, xml: string): string | null {
  const m = xml.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, "i"));
  return m ? decodeEntities(m[1]) : null;
}

interface RawItem {
  title: string;
  link: string;
  publishedAt: string;
  category: string;
}

async function fetchFeed(url: string, category: string): Promise<RawItem[]> {
  try {
    const res = await fetch(url, {
      headers: { "user-agent": "Mozilla/5.0 (brazil-trading)" },
    });
    if (!res.ok) return [];
    const xml = await res.text();
    const items = xml.match(/<item[\s\S]*?<\/item>/gi) ?? [];
    return items
      .map((block) => {
        const title = pick("title", block);
        const link = pick("link", block);
        const pub = pick("pubDate", block);
        if (!title || !link) return null;
        const d = pub ? new Date(pub) : null;
        return {
          title,
          link,
          category,
          publishedAt:
            d && !Number.isNaN(d.getTime())
              ? d.toISOString()
              : new Date().toISOString(),
        };
      })
      .filter((x): x is RawItem => x !== null);
  } catch {
    return [];
  }
}

export async function fetchBrazilNews(limit = 5): Promise<NewsItem[]> {
  const feeds = await Promise.all(FEEDS.map((f) => fetchFeed(f.url, f.category)));
  const byLink = new Map<string, RawItem>();
  for (const item of feeds.flat()) {
    if (!byLink.has(item.link)) byLink.set(item.link, item);
  }
  const merged = [...byLink.values()]
    .sort((a, b) => b.publishedAt.localeCompare(a.publishedAt))
    .slice(0, limit);

  const translated = await Promise.all(
    merged.map(async (item) => ({
      titleKo: (await translatePtToKo(item.title)) ?? item.title,
      titlePt: item.title,
      link: item.link,
      category: item.category,
      publishedAt: item.publishedAt,
      source: "G1",
    }))
  );

  return translated;
}
