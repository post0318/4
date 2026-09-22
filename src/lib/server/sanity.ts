/**
 * 외부 소스에서 받은 수치의 팩트 검증(1차): 상식적 범위를 벗어나면 값을 버리고
 * 신뢰할 수 없음을 알린다. LLM 없이 "명백히 틀린 값"을 걸러내는 방어선이다.
 *
 * 범위는 넉넉하게 잡되(정상값은 절대 거르지 않게), 소스 장애/파싱 오류로 인한
 * 말도 안 되는 값(0, 음수, 자릿수 오류 등)만 잡아낸다.
 */

export const BOUNDS = {
  usdKrw: [700, 3000],
  usdBrl: [1, 15],
  krwBrl: [50, 2000],
  /** Selic·국채수익률 등 연 % 금리 */
  ratePct: [0, 40],
  /** 월간 물가상승률 % */
  cpiMoMPct: [-5, 8],
} as const;

export function inRange(value: unknown, [lo, hi]: readonly [number, number]): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= lo && value <= hi;
}

/** 시계열에서 범위 밖 포인트를 제거하고 (정리된 시계열, 제거 개수)를 돌려준다 */
export function sanitizeSeries(
  dates: string[],
  values: number[],
  bounds: readonly [number, number]
): { dates: string[]; values: number[]; dropped: number } {
  const outD: string[] = [];
  const outV: number[] = [];
  let dropped = 0;
  for (let i = 0; i < values.length; i++) {
    if (inRange(values[i], bounds) && /^\d{4}-\d{2}-\d{2}$/.test(dates[i] ?? "")) {
      outD.push(dates[i]);
      outV.push(values[i]);
    } else {
      dropped++;
    }
  }
  return { dates: outD, values: outV, dropped };
}

/** 스냅샷을 "오래됨"으로 보는 기준(일). 주간 갱신이므로 한 주기 + 여유. */
export const SNAPSHOT_STALE_DAYS = 10;

/** 스냅샷 기준일의 경과일수와 노후 여부 (감사 ⑤ 중3) */
export function snapshotFreshness(asOfIso: string | null): {
  asOfDate: string | null;
  ageDays: number | null;
  stale: boolean;
} {
  if (!asOfIso) return { asOfDate: null, ageDays: null, stale: true };
  const t = new Date(asOfIso).getTime();
  if (Number.isNaN(t)) return { asOfDate: asOfIso, ageDays: null, stale: true };
  const ageDays = Math.floor((Date.now() - t) / 86_400_000);
  return { asOfDate: asOfIso, ageDays, stale: ageDays > SNAPSHOT_STALE_DAYS };
}
