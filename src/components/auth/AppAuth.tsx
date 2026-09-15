"use client";

import { createContext, useContext, type ReactNode } from "react";
import { useClerk, useUser } from "@clerk/nextjs";

/**
 * 앱 인증 컨텍스트. Clerk 훅은 ClerkProvider 밖에서 부르면 예외가 나므로,
 * Clerk 키가 없는 환경(로컬 초기 상태)에서는 "비활성" 값을 대신 제공한다.
 * 화면 컴포넌트는 이 훅만 쓰고 Clerk 를 직접 참조하지 않는다.
 */
export interface AppAuth {
  /** Clerk 키가 설정되어 인증을 쓸 수 있는가 */
  enabled: boolean;
  /** Clerk 초기화 완료 여부 (false 면 아직 모름) */
  isLoaded: boolean;
  isSignedIn: boolean;
  /** 로그인한 계정의 대표 이메일 */
  email: string | null;
  /** 로그인 팝업 열기 */
  openSignIn: () => void;
  /** 내 계정 팝업(비밀번호 변경 등) 열기 */
  openProfile: () => void;
  signOut: () => Promise<void>;
  /** 대기자 가입 신청 (승인 후 로그인 가능). 실패 시 메시지를 던진다. */
  joinWaitlist: (emailAddress: string) => Promise<void>;
}

const DISABLED: AppAuth = {
  enabled: false,
  isLoaded: true,
  isSignedIn: false,
  email: null,
  openSignIn: () => {},
  openProfile: () => {},
  signOut: async () => {},
  joinWaitlist: async () => {
    throw new Error("인증 서비스가 설정되지 않았습니다.");
  },
};

const Ctx = createContext<AppAuth>(DISABLED);

function ClerkBridge({ children }: { children: ReactNode }) {
  const clerk = useClerk();
  const { isLoaded, isSignedIn, user } = useUser();
  const value: AppAuth = {
    enabled: true,
    isLoaded,
    isSignedIn: !!isSignedIn,
    email:
      user?.primaryEmailAddress?.emailAddress ??
      user?.emailAddresses?.[0]?.emailAddress ??
      null,
    openSignIn: () => clerk.openSignIn({}),
    openProfile: () => clerk.openUserProfile({}),
    signOut: () => clerk.signOut(),
    joinWaitlist: async (emailAddress) => {
      try {
        await clerk.joinWaitlist({ emailAddress });
      } catch (e) {
        const msg =
          (e as { errors?: { longMessage?: string; message?: string }[] })?.errors?.[0]
            ?.longMessage ??
          (e as { errors?: { message?: string }[] })?.errors?.[0]?.message ??
          (e instanceof Error ? e.message : "가입 신청에 실패했습니다.");
        throw new Error(msg);
      }
    },
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function AppAuthProvider({
  enabled,
  children,
}: {
  enabled: boolean;
  children: ReactNode;
}) {
  if (!enabled) return <Ctx.Provider value={DISABLED}>{children}</Ctx.Provider>;
  return <ClerkBridge>{children}</ClerkBridge>;
}

export function useAppAuth(): AppAuth {
  return useContext(Ctx);
}

/** 이메일이 허용 도메인 목록에 속하는지 (클라이언트 안내용 — 최종 판단은 서버) */
export function isAllowedEmail(email: string, allowedDomains: string[]): boolean {
  const at = email.lastIndexOf("@");
  if (at < 0) return false;
  const domain = email.slice(at + 1).toLowerCase();
  return allowedDomains.some((d) => domain === d.toLowerCase());
}
