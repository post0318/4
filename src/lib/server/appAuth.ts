import "server-only";
import { auth, currentUser } from "@clerk/nextjs/server";

/**
 * 트레이딩(주문 발송·수신자 조회)·공유 링크 생성 API 의 서버 측 잠금
 * (감사 ⑤ 치명1). Clerk 세션이 있고, 그 계정의 이메일이 허용 도메인
 * (`ALLOWED_EMAIL_DOMAINS`, 기본 hanwha.com)에 속하거나 관리자 목록
 * (`ADMIN_EMAILS`)에 있어야 통과한다.
 *
 * 대기자(Waitlist) 모드에서는 관리자가 승인한 사람만 Clerk 사용자로 존재하므로,
 * 세션이 있다는 것 자체가 "승인됨"을 뜻한다. 도메인 검사는 승인 실수를 막는
 * 두 번째 방어선이다.
 */

export function allowedEmailDomains(): string[] {
  const raw = process.env.ALLOWED_EMAIL_DOMAINS ?? "hanwha.com";
  return raw
    .split(/[,;\s]+/)
    .map((d) => d.trim().toLowerCase().replace(/^@/, ""))
    .filter(Boolean);
}

export function clerkConfigured(): boolean {
  return !!process.env.CLERK_SECRET_KEY && !!process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY;
}

/** 도메인과 무관하게 통과하는 관리자 이메일(`ADMIN_EMAILS`, 쉼표 구분) */
export function adminEmails(): string[] {
  return (process.env.ADMIN_EMAILS ?? "")
    .split(/[,;\s]+/)
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
}

export function isAllowedEmail(email: string): boolean {
  const e = email.trim().toLowerCase();
  if (adminEmails().includes(e)) return true;
  const at = e.lastIndexOf("@");
  if (at < 0) return false;
  return allowedEmailDomains().includes(e.slice(at + 1));
}

export type TradingUserResult =
  | { ok: true; email: string; userId: string }
  | { ok: false; status: 401 | 403 | 503; error: string };

export async function requireTradingUser(): Promise<TradingUserResult> {
  if (!clerkConfigured()) {
    return { ok: false, status: 503, error: "인증 서비스(Clerk)가 설정되지 않았습니다." };
  }
  const { userId } = await auth();
  if (!userId) return { ok: false, status: 401, error: "로그인이 필요합니다." };

  const user = await currentUser();
  const email =
    user?.primaryEmailAddress?.emailAddress ?? user?.emailAddresses?.[0]?.emailAddress ?? "";
  if (!email || !isAllowedEmail(email)) {
    return {
      ok: false,
      status: 403,
      error: `회사 이메일(${allowedEmailDomains().map((d) => "@" + d).join(", ")}) 계정만 사용할 수 있습니다.`,
    };
  }
  return { ok: true, email, userId };
}
