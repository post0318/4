const API_URL = "https://api.frankfurter.dev/v1/latest";

/**
 * 유럽중앙은행(ECB) 기준 환율을 제공하는 무료 공개 API(Frankfurter.dev, 인증
 * 불필요)로 base/quote 통화쌍의 환율을 조회한다. investing.com은 Cloudflare
 * 봇 차단(403)으로 서버에서 직접 조회가 불가능해(세이브로와 동일한 사유) 이
 * 경로를 쓴다. 같은 통화면 조회 없이 1을 반환한다.
 */
export async function fetchFxRate(
  base: string,
  quote: string
): Promise<number | null> {
  if (base === quote) return 1;

  const url = `${API_URL}?base=${encodeURIComponent(base)}&symbols=${encodeURIComponent(quote)}`;
  const res = await fetch(url);
  if (!res.ok) return null;

  const data = (await res.json()) as { rates?: Record<string, number> };
  const rate = data.rates?.[quote];
  return typeof rate === "number" ? rate : null;
}
