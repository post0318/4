/**
 * 브라질 현지 주요 뉴스를 Google 뉴스(pt-BR) RSS에서 모은다. "주요 뉴스" 피드는
 * 노출도(보도량)가 높은 순으로 클러스터링되므로 "가장 많이 다뤄진 뉴스"에 가깝다.
 * 제목은 translatePtToKo로 한글 번역하고, 실패 시 원문을 쓴다. 결과는 라우트에서
 * 캐시(revalidate)한다.
 */

import { translateChecked } from "@/lib/server/translate";

const UA = "Mozilla/5.0 (compatible; brazil-trading/1.0)";
const GN = (path: string) =>
  `https://news.google.com/rss/${path}${
    path.includes("?") ? "&" : "?"
  }hl=pt-BR&gl=BR&ceid=BR:pt-419`;

// 라운드로빈으로 한 건씩 뽑아 경제·정치·사회를 고르게 섞는다
const MACRO_QUERY =
  "(economia OR juros OR inflação OR Copom OR fiscal OR dólar OR \"Banco Central\") Brasil";
const FEEDS: { url: string; category: string }[] = [
  { url: GN(`search?q=${encodeURIComponent(MACRO_QUERY)}`), category: "경제" },
  { url: GN("headlines/section/topic/NATION"), category: "정치·사회" },
  { url: GN(""), category: "주요" },
];

export interface NewsItem {
  titleKo: string;
  titlePt: string;
  /** 왕복검증 통과 여부. false면 번역이 의심스러우니 원문 우선 */
  translationOk: boolean;
  link: string;
  category: string;
  publishedAt: string;
  source: string;
}

// 경제·정치·사회와 무관한 잡음(복권·운세·연예·스포츠 결과 등) 제외
const NOISE =
  /lotof[aá]cil|mega-?sena|lotomania|\bquina\b|dupla sena|loteria|hor[oó]scopo|\bsigno|zod[ií]aco|bbb\s*\d|big brother|novela|resultado do concurso|escala[çc][aã]o|pr[oó]ximo jogo/i;

function decode(s: string): string {
  return s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&amp;/g, "&")
    .trim();
}

function tag(name: string, xml: string): string | null {
  const m = xml.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`, "i"));
  return m ? decode(m[1]) : null;
}

interface RawItem {
  title: string;
  link: string;
  source: string;
  category: string;
  publishedAt: string;
}

async function fetchFeed(url: string, category: string): Promise<RawItem[]> {
  try {
    const res = await fetch(url, { headers: { "user-agent": UA } });
    if (!res.ok) return [];
    const xml = await res.text();
    const blocks = xml.match(/<item>[\s\S]*?<\/item>/gi) ?? [];
    return blocks
      .map((b) => {
        const rawTitle = tag("title", b);
        const link = tag("link", b);
        if (!rawTitle || !link) return null;
        const source = tag("source", b) ?? "Google 뉴스";
        // "헤드라인 - 매체" 형식에서 매체명 꼬리 제거
        const title = rawTitle
          .replace(new RegExp(`\\s*[-–]\\s*${source}\\s*$`), "")
          .trim();
        const pub = tag("pubDate", b);
        const d = pub ? new Date(pub) : null;
        return {
          title,
          link,
          source,
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

  // 피드별 큐를 만들어 라운드로빈으로 뽑는다(카테고리 균형). 링크·제목 중복 제거.
  const queues = feeds.map((list) =>
    list.filter((it) => !NOISE.test(it.title))
  );
  const seenLink = new Set<string>();
  const seenTitle = new Set<string>();
  const picked: RawItem[] = [];
  let progressed = true;
  while (picked.length < limit && progressed) {
    progressed = false;
    for (const q of queues) {
      if (picked.length >= limit) break;
      const item = q.shift();
      if (!item) continue;
      progressed = true;
      const tkey = item.title.toLowerCase().slice(0, 40);
      if (seenLink.has(item.link) || seenTitle.has(tkey)) continue;
      seenLink.add(item.link);
      seenTitle.add(tkey);
      picked.push(item);
    }
  }

  return Promise.all(
    picked.map(async (item) => {
      const { ko, ok } = await translateChecked(item.title);
      return {
        titleKo: ko ?? item.title,
        titlePt: item.title,
        translationOk: ok && ko != null,
        link: item.link,
        category: item.category,
        publishedAt: item.publishedAt,
        source: item.source,
      };
    })
  );
}
