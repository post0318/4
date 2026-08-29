/**
 * 이메일 수신자/참조 문자열 파싱. 서버·클라이언트 공용.
 *
 * ";" 또는 "," 로 구분하고, "이름 <a@b.com>" 형식이면 <> 안의 주소를 취한다.
 */

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function parseRecipients(raw: string): string[] {
  return raw
    .split(/[;,]/)
    .map((part) => {
      const m = part.match(/<([^>]+)>/);
      return (m ? m[1] : part).trim();
    })
    .filter(Boolean);
}

export function isEmail(value: string): boolean {
  return EMAIL_RE.test(value);
}

/** 최소 1개 이상이고 전부 유효한 주소인지 */
export function allValidEmails(list: string[]): boolean {
  return list.length > 0 && list.every(isEmail);
}
