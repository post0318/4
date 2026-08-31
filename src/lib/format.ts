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

/** 입력값에서 숫자만 남기고 앞자리 0을 제거한다. 숫자 입력창 정규화용. */
export function digitsOnly(value: string): string {
  return value.replace(/\D/g, "").replace(/^0+(?=\d)/, "");
}

/**
 * 숫자·소수점만 남기고 맨 앞의 불필요한 0을 제거한다(011.11→11.11, 011→11).
 * "0.5", "0", "0."처럼 0 뒤가 소수점이거나 0 하나만 있으면 그대로 둔다.
 */
export function normalizeDecimalInput(value: string): string {
  const cleaned = value.replace(/[^\d.]/g, "");
  const firstDot = cleaned.indexOf(".");
  const oneDot =
    firstDot === -1
      ? cleaned
      : cleaned.slice(0, firstDot + 1) +
        cleaned.slice(firstDot + 1).replace(/\./g, "");
  return oneDot.replace(/^0+(?=\d)/, "");
}

/** 숫자만 있는 문자열에 천 단위 콤마를 넣는다. 입력창 표시용. */
export function groupDigits(digits: string): string {
  if (!digits) return "";
  return digits.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

/**
 * 소수 문자열의 정수부에만 천 단위 콤마를 넣는다("1234567.8" → "1,234,567.8").
 * 소수점 이하와 입력 중 상태("123.")는 그대로 둔다. 입력창 표시용.
 */
export function groupDecimal(value: string): string {
  if (!value) return "";
  const neg = value.startsWith("-") ? "-" : "";
  const body = neg ? value.slice(1) : value;
  const dot = body.indexOf(".");
  const intPart = dot === -1 ? body : body.slice(0, dot);
  const fracPart = dot === -1 ? "" : body.slice(dot);
  return neg + groupDigits(intPart) + fracPart;
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
