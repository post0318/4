const SGS_URL = "https://api.bcb.gov.br/dados/serie/bcdata.sgs.432/dados";

export interface RateSeries {
  /** ISO 날짜, 오름차순 */
  dates: string[];
  /** 연 % */
  values: number[];
}

function brToIso(s: string): string | null {
  const m = s.trim().match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  return m ? `${m[3]}-${m[2]}-${m[1]}` : null;
}

/**
 * 브라질 기준금리(Selic meta, Copom 목표금리) 일간 시계열을 브라질 중앙은행
 * SGS(시리즈 432, 무인증)에서 받아 값이 바뀐 시점 + 마지막 날짜만 남겨 반환한다.
 * 기준금리는 Copom 회의(연 8회)에만 바뀌므로 계단식으로 그리면 충분하다.
 * from/to 는 ISO(YYYY-MM-DD). SGS가 가끔 XML 오류를 주므로 방어한다.
 */
export async function fetchSelicHistory(
  from: string,
  to: string
): Promise<RateSeries | null> {
  const toBr = (iso: string) => iso.split("-").reverse().join("/");
  const url = `${SGS_URL}?formato=json&dataInicial=${toBr(from)}&dataFinal=${toBr(to)}`;
  const res = await fetch(url);
  if (!res.ok) return null;

  const text = await res.text();
  if (!text.trimStart().startsWith("[")) return null;

  let raw: { data: string; valor: string }[];
  try {
    raw = JSON.parse(text);
  } catch {
    return null;
  }

  const dates: string[] = [];
  const values: number[] = [];
  let prev: number | null = null;
  raw.forEach((row, i) => {
    const iso = brToIso(row.data);
    const v = Number(row.valor);
    if (!iso || !Number.isFinite(v)) return;
    if (v !== prev || i === raw.length - 1) {
      dates.push(iso);
      values.push(v);
      prev = v;
    }
  });

  return dates.length ? { dates, values } : null;
}

/**
 * 교차검증용: SGS 432(Meta Selic)의 최신 1개 값을 독립적으로 조회한다.
 * 시계열 파싱 결과의 마지막 값과 대조해 회귀 오류를 잡는다.
 */
export async function fetchSelicLatest(): Promise<number | null> {
  try {
    const res = await fetch(`${SGS_URL}/ultimos/1?formato=json`);
    if (!res.ok) return null;
    const text = await res.text();
    if (!text.trimStart().startsWith("[")) return null;
    const arr = JSON.parse(text) as { valor: string }[];
    const v = Number(arr[0]?.valor);
    return Number.isFinite(v) ? v : null;
  } catch {
    return null;
  }
}
