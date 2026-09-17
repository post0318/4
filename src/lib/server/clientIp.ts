import "server-only";

/**
 * 요청자 IP — 고객 열람 링크 워터마크용(캡처 유출 추적·억제).
 * Vercel 은 `x-forwarded-for` 첫 값에 실제 접속 IP 를 넣는다. 로컬 개발은
 * 프록시가 없어 헤더가 비거나 `::1` 이다.
 * 워터마크 SVG 문자열에 그대로 들어가므로 IP 문자(숫자·16진수·`.`·`:`)만 통과시킨다.
 */
export function clientIpFrom(h: Headers): string | null {
  const raw = h.get("x-forwarded-for")?.split(",")[0] ?? h.get("x-real-ip") ?? "";
  const ip = raw.trim().replace(/^::ffff:/i, "");
  return /^[0-9a-fA-F.:]{2,45}$/.test(ip) ? ip : null;
}
