/**
 * pt→ko 번역. 무인증 Google 번역 웹 엔드포인트를 먼저 쓰고(품질 양호),
 * 실패하면 MyMemory로 폴백한다. 둘 다 실패하면 null.
 * 호출 측 라우트에서 캐시(revalidate)하므로 호출량은 적다.
 */

async function viaGoogle(text: string): Promise<string | null> {
  try {
    const url =
      `https://translate.googleapis.com/translate_a/single?client=gtx&sl=pt&tl=ko&dt=t&q=` +
      encodeURIComponent(text);
    const res = await fetch(url, {
      headers: { "user-agent": "Mozilla/5.0" },
    });
    if (!res.ok) return null;
    // 응답: [[["번역","원문",...], ...], ...]
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

async function viaMyMemory(text: string): Promise<string | null> {
  try {
    const res = await fetch(
      `https://api.mymemory.translated.net/get?q=${encodeURIComponent(
        text
      )}&langpair=pt|ko`
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
  return (await viaGoogle(text)) ?? (await viaMyMemory(text));
}
