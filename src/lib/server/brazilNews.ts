/**
 * 브라질 현지 주요 뉴스를 Google 뉴스(pt-BR) RSS에서 모은다. "주요 뉴스" 피드는
 * 노출도(보도량)가 높은 순으로 클러스터링되므로 "가장 많이 다뤄진 뉴스"에 가깝다.
 * 제목은 translatePtToKo로 한글 번역하고, 실패 시 원문을 쓴다. 결과는 라우트에서
 * 캐시(revalidate)한다.
 */

import { translateChecked } from "@/lib/server/translate";

const UA = "Mozilla/5.0 (compatible; brazil-trading/1.0)";
const GN = (path: string, locale = "hl=pt-BR&gl=BR&ceid=BR:pt-419") =>
  `https://news.google.com/rss/${path}${
    path.includes("?") ? "&" : "?"
  }${locale}`;
const EN_LOCALE = "hl=en-US&gl=US&ceid=US:en";

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

  return translateItems(picked, "pt");
}

const GLOBAL_QUERY =
  'Brazil (economy OR politics OR markets OR Lula OR "central bank" OR real OR bonds OR Petrobras)';

// 거시·정치·시장과 무관한 기업/기술/문화 기사 제외 (국채 판단에 도움 안 됨).
// 단, 중앙은행 규제·관세 등 정책 맥락이면 통과되도록 키워드를 좁게 잡는다.
const GLOBAL_OFF_TOPIC =
  /openai|chatgpt|\bllm\b|generative ai|data ?cent(er|re)|streaming|netflix|spotify|tiktok|world cup|olympics?|neymar|\bfootball\b|\bsoccer\b|carnival|celebrity|box office|\bfilm\b|\bmovie\b/i;

/**
 * 브라질 관련 글로벌(영문) 뉴스 상위 N개. Google 뉴스 영문 검색 피드는 보도량
 * 기준으로 정렬되므로 "글로벌 상위"에 가깝다. 제목은 en→ko 번역.
 */
export async function fetchGlobalBrazilNews(limit = 5): Promise<NewsItem[]> {
  const list = await fetchFeed(
    GN(`search?q=${encodeURIComponent(GLOBAL_QUERY)}`, EN_LOCALE),
    "글로벌"
  );
  const seen = new Set<string>();
  const picked: RawItem[] = [];
  for (const it of list) {
    if (NOISE.test(it.title) || GLOBAL_OFF_TOPIC.test(it.title)) continue;
    const tkey = it.title.toLowerCase().slice(0, 40);
    if (seen.has(tkey)) continue;
    seen.add(tkey);
    picked.push(it);
    if (picked.length >= limit) break;
  }
  return translateItems(picked, "en");
}

/**
 * 제목을 번역·검증한다. 무인증 Google 엔드포인트가 rate limit(429)에 걸리면
 * 번역이 느려지거나 실패하므로:
 *  - 동시 요청은 소수(POOL)로 제한하고
 *  - 전체 시간예산(DEADLINE_MS)을 넘기면 남은 항목은 원문 그대로 반환한다
 *    (라우트가 타임아웃돼 글로벌 뉴스가 통째로 사라지는 것을 방지).
 * 번역을 못 한 항목은 원문을 보여주되 "번역 불확실" 배지는 달지 않는다
 * (번역이 틀린 게 아니라 안 한 것이므로).
 */
const POOL = 5;
const DEADLINE_MS = 7000;

async function translateItems(
  items: RawItem[],
  sl: "pt" | "en"
): Promise<NewsItem[]> {
  const checked = new Array<{ ko: string | null; ok: boolean } | null>(
    items.length
  ).fill(null);
  const deadline = Date.now() + DEADLINE_MS;
  let next = 0;

  async function worker() {
    while (next < items.length && Date.now() < deadline) {
      const i = next++;
      checked[i] = await translateChecked(items[i].title, sl);
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(POOL, items.length) }, worker)
  );

  return items.map((item, i) => {
    const r = checked[i];
    return {
      titleKo: r?.ko ?? item.title,
      titlePt: item.title,
      // 번역 성공 → 검증 결과, 번역 안 함(원문 노출) → 배지 없음
      translationOk: r?.ko ? r.ok : true,
      link: item.link,
      category: item.category,
      publishedAt: item.publishedAt,
      source: item.source,
    };
  });
}
