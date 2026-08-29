/**
 * 제목 번역 + 가벼운 왕복검증. 무인증 Google 번역 웹 엔드포인트를 먼저 쓰고
 * (품질 양호), 실패하면 MyMemory로 폴백한다. LLM 토큰·유료 API 없음.
 *
 * translateChecked: 번역 후 역번역이 원문과 크게 어긋나면(오역 의심) ok:false 로
 * 표시해 화면에서 원문을 우선 노출하게 한다. Google이 rate limit에 걸려도(429)
 * 라우트가 멈추지 않도록 각 요청에 타임아웃을 두고, MyMemory 폴백 시엔 왕복검증을
 * 생략한다(Google이 죽어 있으면 어차피 역번역도 실패).
 */

const REQ_TIMEOUT_MS = 3500;

async function viaGoogle(
  text: string,
  sl = "pt",
  tl = "ko"
): Promise<string | null> {
  try {
    const url =
      `https://translate.googleapis.com/translate_a/single?client=gtx&sl=${sl}&tl=${tl}&dt=t&q=` +
      encodeURIComponent(text);
    const res = await fetch(url, {
      headers: { "user-agent": "Mozilla/5.0" },
      signal: AbortSignal.timeout(REQ_TIMEOUT_MS),
    });
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

async function viaMyMemory(text: string, sl = "pt"): Promise<string | null> {
  try {
    const res = await fetch(
      `https://api.mymemory.translated.net/get?q=${encodeURIComponent(
        text
      )}&langpair=${sl}|ko`,
      { signal: AbortSignal.timeout(REQ_TIMEOUT_MS) }
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

/** pt→ko 단순 번역 (스냅샷 파이프라인 등에서 사용). */
export async function translatePtToKo(text: string): Promise<string | null> {
  return (await viaGoogle(text)) ?? (await viaMyMemory(text, "pt"));
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
  // 1) Google 시도 + 성공 시에만 왕복검증
  const gk = await viaGoogle(src, sl, "ko");
  if (gk && gk.trim() !== src.trim()) {
    const back = await viaGoogle(gk, "ko", sl);
    if (!back) return { ko: gk, ok: true }; // 역번역 불가 → 판단 보류
    return { ko: gk, ok: dice(contentWords(back), contentWords(src)) >= 0.3 };
  }
  // 2) Google 실패/미번역 → MyMemory 폴백 (왕복검증 생략, 신뢰)
  const mk =
    sl === "pt" || sl === "en" ? await viaMyMemory(src, sl) : null;
  if (mk && mk.trim() !== src.trim()) return { ko: mk, ok: true };
  return { ko: null, ok: false };
}
