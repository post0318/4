import "server-only";

/**
 * Google 뉴스 RSS 링크(news.google.com/rss/articles/…) → 원문 URL → 본문 텍스트.
 *
 * Google 뉴스 링크는 JS 로 넘겨주는 중간 페이지라 그대로는 원문을 못 읽는다.
 * 중간 페이지의 서명(data-n-a-sg)·시각(data-n-a-ts)으로 batchexecute 를 불러
 * 원문 URL 을 받는다(googlenewsdecoder 와 같은 방식, 2026-10-11 실측 동작).
 * Google 이 형식을 바꾸면 null — 호출 쪽이 Google 링크 그대로 모델에 넘긴다.
 *
 * 본문은 <p> 문단만 모은다. 유료벽·봇 차단(403)이면 빈 문자열.
 */

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130 Safari/537.36";
const STEP_TIMEOUT_MS = 6000;
const MAX_TEXT = 12_000;

export function isGoogleNewsLink(link: string): boolean {
  try {
    const u = new URL(link);
    return u.hostname === "news.google.com" && u.pathname.includes("/articles/");
  } catch {
    return false;
  }
}

export async function resolveGoogleNewsUrl(link: string): Promise<string | null> {
  if (!isGoogleNewsLink(link)) return link;
  try {
    const id = new URL(link).pathname.split("/").pop() ?? "";
    const page = await fetch(`https://news.google.com/rss/articles/${id}`, {
      headers: { "user-agent": UA },
      signal: AbortSignal.timeout(STEP_TIMEOUT_MS),
    });
    const html = await page.text();
    const sg = html.match(/data-n-a-sg="([^"]+)"/)?.[1];
    const ts = html.match(/data-n-a-ts="([^"]+)"/)?.[1];
    if (!sg || !ts) return null;
    const inner = JSON.stringify([
      "garturlreq",
      [["X", "X", ["X", "X"], null, null, 1, 1, "US:en", null, 1, null, null, null, null, null, 0, 1],
        "X", "X", 1, [1, 1, 1], 1, 1, null, 0, 0, null, 0],
      id,
      Number(ts),
      sg,
    ]);
    const res = await fetch("https://news.google.com/_/DotsSplashUi/data/batchexecute", {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded;charset=UTF-8",
        "user-agent": UA,
      },
      body: "f.req=" + encodeURIComponent(JSON.stringify([[["Fbv4je", inner, null, "generic"]]])),
      signal: AbortSignal.timeout(STEP_TIMEOUT_MS),
    });
    const url = (await res.text()).match(/\[\\"garturlres\\",\\"(.*?)\\"/)?.[1];
    return url && /^https?:\/\//.test(url) ? url : null;
  } catch {
    return null;
  }
}

function decodeEntities(s: string): string {
  return s
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;|&#x27;/g, "'")
    .replace(/&#(\d+);/g, (m, n) => {
      try {
        return String.fromCodePoint(Number(n));
      } catch {
        return m;
      }
    })
    .replace(/&amp;/g, "&");
}

export async function fetchArticleText(url: string): Promise<string> {
  try {
    const res = await fetch(url, {
      headers: { "user-agent": UA, "accept-language": "en-US,en;q=0.9" },
      signal: AbortSignal.timeout(STEP_TIMEOUT_MS),
    });
    if (!res.ok) return "";
    const html = (await res.text()).replace(/<(script|style|noscript)[\s\S]*?<\/\1>/gi, "");
    const paras = [...html.matchAll(/<p[^>]*>([\s\S]*?)<\/p>/gi)]
      .map((m) => decodeEntities(m[1].replace(/<[^>]+>/g, "")).replace(/\s+/g, " ").trim())
      .filter((t) => t.length > 60);
    return paras.join("\n").slice(0, MAX_TEXT);
  } catch {
    return "";
  }
}
