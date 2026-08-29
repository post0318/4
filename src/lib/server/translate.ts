/**
 * pt→ko 번역 + 왕복검증. 무인증 Google 번역 웹 엔드포인트를 먼저 쓰고(품질 양호),
 * 실패하면 MyMemory로 폴백한다. LLM 토큰·유료 API 없음.
 *
 * translateChecked: pt→ko 후 ko→pt 역번역이 원문과 크게 어긋나면(오역 의심)
 * ok:false 로 표시해 화면에서 원문을 우선 노출하게 한다.
 */

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function viaGoogleOnce(
  text: string,
  sl: string,
  tl: string
): Promise<string | null> {
  try {
    const url =
      `https://translate.googleapis.com/translate_a/single?client=gtx&sl=${sl}&tl=${tl}&dt=t&q=` +
      encodeURIComponent(text);
    const res = await fetch(url, { headers: { "user-agent": "Mozilla/5.0" } });
    if (!res.ok) return null;
    const data = (await res.json()) as unknown;
    if (!Array.isArray(data) || !Array.isArray(data[0])) return null;
    const out = (data[0] as unknown[])
      .map((seg) => (Array.isArray(seg) ? String(seg[0] ?? "") : ""))
      .join("")
      .trim();
    return out || null;
  } catch {
    return null;
  }
}

/** 무인증 엔드포인트가 429/빈응답을 자주 내므로 1회 재시도한다(짧은 백오프). */
async function viaGoogle(
  text: string,
  sl = "pt",
  tl = "ko"
): Promise<string | null> {
  const first = await viaGoogleOnce(text, sl, tl);
  if (first) return first;
  await wait(400);
  return viaGoogleOnce(text, sl, tl);
}

async function viaMyMemory(text: string, sl = "pt"): Promise<string | null> {
  try {
    const res = await fetch(
      `https://api.mymemory.translated.net/get?q=${encodeURIComponent(
        text
      )}&langpair=${sl}|ko`
    );
    if (!res.ok) return null;
    const data = (await res.json()) as {
      responseStatus?: number;
      responseData?: { translatedText?: string };
    };
    const out = data.responseData?.translatedText;
    if (!out || data.responseStatus !== 200) return null;
    if (/MYMEMORY WARNING|QUERY LENGTH LIMIT|INVALID/i.test(out)) return null;
    return out;
  } catch {
    return null;
  }
}

export async function translatePtToKo(text: string): Promise<string | null> {
  return (await viaGoogle(text)) ?? (await viaMyMemory(text, "pt"));
}

/** 임의 원어(en/pt 등) → ko. Google 우선, 실패 시 MyMemory 폴백(en·pt 지원). */
export async function translateToKo(
  text: string,
  sl: string
): Promise<string | null> {
  const g = await viaGoogle(text, sl, "ko");
  if (g) return g;
  return sl === "pt" || sl === "en" ? await viaMyMemory(text, sl) : null;
}

function contentWords(s: string): Set<string> {
  return new Set(
    s
      .toLowerCase()
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/[^a-z0-9\s]/g, " ")
      .split(/\s+/)
      .filter((w) => w.length > 2)
  );
}

/** 두 문자열의 내용어 집합 Dice 계수 (0~1) */
function dice(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 1;
  let inter = 0;
  for (const w of a) if (b.has(w)) inter++;
  return (2 * inter) / (a.size + b.size);
}

export async function translateChecked(
  src: string,
  sl = "pt"
): Promise<{ ko: string | null; ok: boolean }> {
  const ko = await translateToKo(src, sl);
  if (!ko) return { ko: null, ok: false };
  if (ko.trim() === src.trim()) return { ko, ok: false }; // 미번역

  const back = await viaGoogle(ko, "ko", sl);
  if (!back) return { ko, ok: true }; // 역번역 실패 → 판단 보류
  return { ko, ok: dice(contentWords(back), contentWords(src)) >= 0.3 };
}
