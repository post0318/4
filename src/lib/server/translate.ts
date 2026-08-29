/**
 * MyMemory(무인증·무료 MT)로 pt→ko 번역. 실패 시 null.
 * 호출 측 라우트에서 캐시(revalidate)하므로 무료 한도 안에서 동작한다.
 */
export async function translatePtToKo(text: string): Promise<string | null> {
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
