export function fmtNum(n: number | null | undefined, digits = 2): string {
  if (typeof n !== "number" || !Number.isFinite(n)) return "-";
  return n.toLocaleString("ko-KR", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

export function fmtInt(n: number | null | undefined): string {
  if (typeof n !== "number" || !Number.isFinite(n)) return "-";
  return Math.round(n).toLocaleString("ko-KR");
}

/** ISO 문자열 → "YYYY-MM-DD HH:mm" (브라우저 로컬 시간대) */
export function fmtTimestamp(iso: string | null): string {
  if (!iso) return "-";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "-";
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(
    d.getHours()
  )}:${p(d.getMinutes())}`;
}
