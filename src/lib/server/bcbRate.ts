import { fetchOrNull } from "@/lib/server/fetchWithTimeout";
const SGS_URL = "https://api.bcb.gov.br/dados/serie/bcdata.sgs.432/dados";
/**
 * BCB SGS 는 7년치 일간 시계열을 처음 부를 때 25초까지 걸린다(측정). 공통 6초
 * 타임아웃으로는 잘려서 502 가 나고, 그 응답이 12시간 캐시에 박혀 화면의
 * 기준금리가 하루 종일 "-" 로 보였다. 이 소스만 넉넉히 준다.
 */
const BCB_TIMEOUT_MS = 30000;

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
  const res = await fetchOrNull(url, {}, BCB_TIMEOUT_MS);
  if (!res) return null;

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
export async function fetchSelicLatest(): Promise<{
  value: number;
  date: string | null;
} | null> {
  try {
    const res = await fetchOrNull(
      `${SGS_URL}/ultimos/1?formato=json`,
      {},
      BCB_TIMEOUT_MS
    );
    if (!res) return null;
    const text = await res.text();
    if (!text.trimStart().startsWith("[")) return null;
    const arr = JSON.parse(text) as { data?: string; valor: string }[];
    const v = Number(arr[0]?.valor);
    if (!Number.isFinite(v)) return null;
    return { value: v, date: arr[0]?.data ? brToIso(arr[0].data) : null };
  } catch {
    return null;
  }
}
