const API_BASE = "https://api.frankfurter.dev/v1";
const API_URL = `${API_BASE}/latest`;

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

export interface FxSeries {
  /** ISO 날짜, 오름차순 */
  dates: string[];
  /** 원/달러 (1 USD = ? KRW) */
  usdKrw: number[];
  /** 달러/헤알 (1 USD = ? BRL) */
  usdBrl: number[];
}

/**
 * Frankfurter 시계열 API로 from~to(ISO) 구간의 USD→KRW·USD→BRL 일간 환율을
 * 한 번에 받아온다. ECB 영업일만 데이터가 있고 주말·휴일은 빠진다. 두 값이 모두
 * 있는 날짜만 정렬해 반환한다. 원/헤알은 호출 측에서 usdKrw/usdBrl로 파생한다.
 */
export async function fetchFxSeries(
  from: string,
  to: string
): Promise<FxSeries | null> {
  const url = `${API_BASE}/${from}..${to}?base=USD&symbols=KRW,BRL`;
  const res = await fetch(url);
  if (!res.ok) return null;

  const data = (await res.json()) as {
    rates?: Record<string, { KRW?: number; BRL?: number }>;
  };
  if (!data.rates) return null;

  const dates: string[] = [];
  const usdKrw: number[] = [];
  const usdBrl: number[] = [];
  for (const date of Object.keys(data.rates).sort()) {
    const r = data.rates[date];
    if (typeof r?.KRW === "number" && typeof r?.BRL === "number") {
      dates.push(date);
      usdKrw.push(r.KRW);
      usdBrl.push(r.BRL);
    }
  }
  return { dates, usdKrw, usdBrl };
}
