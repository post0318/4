"use client";

import { useAppAuth } from "@/components/auth/AppAuth";

interface TradingGateProps {
  /** 「가입 신청」 클릭 → 가입 신청 팝업 열기 */
  onSignup: () => void;
}

/**
 * 트레이딩 탭 진입 문. 로그인 전에는 탭 내용 대신 이 안내가 보이고, 탭을 누른
 * 순간 로그인 팝업도 함께 뜬다(OrderConsole.changeTab). 여기서는 다시 열 수 있는
 * 버튼과 가입 신청 버튼만 둔다. 승인 판정은 서버(/api/auth/me).
 */
export function TradingGate({ onSignup }: TradingGateProps) {
  const auth = useAppAuth();

  if (!auth.enabled) {
    return (
      <Box>
        <p className="font-medium">인증 서비스가 아직 설정되지 않았습니다.</p>
        <p className="mt-1 text-xs text-zinc-500">
          Vercel 마켓플레이스에서 Clerk 를 연결하면(환경변수 자동 주입) 트레이딩 탭이
          열립니다.
        </p>
      </Box>
    );
  }

  if (!auth.isLoaded || (auth.isSignedIn && auth.allowed === null)) {
    return (
      <Box>
        <p className="text-sm text-zinc-500">접근 권한 확인 중…</p>
      </Box>
    );
  }

  if (auth.isSignedIn && auth.allowed === false) {
    return (
      <Box>
        <p className="font-medium text-red-700 dark:text-red-300">
          이 계정은 트레이딩 탭을 쓸 수 없습니다.
        </p>
        <p className="mt-1 text-xs text-zinc-500">
          현재 계정 {auth.email}
          {auth.deniedReason ? ` · ${auth.deniedReason}` : ""}
        </p>
        <button
          type="button"
          onClick={() => void auth.signOut()}
          className={`${btnSecondary} mt-3`}
        >
          로그아웃
        </button>
      </Box>
    );
  }

  return (
    <Box>
      <p className="font-medium">트레이딩 탭은 승인된 담당자만 사용할 수 있습니다.</p>
      <p className="mt-1 text-xs text-zinc-500">
        로그인하거나, 계정이 없으면 가입을 신청하세요.
      </p>
      <div className="mt-3 flex flex-wrap gap-2">
        <button type="button" onClick={auth.openSignIn} className={btnPrimary}>
          로그인
        </button>
        <button type="button" onClick={onSignup} className={btnSecondary}>
          가입 신청
        </button>
      </div>
    </Box>
  );
}

function Box({ children }: { children: React.ReactNode }) {
  return (
    <section className="mx-auto w-full max-w-md rounded-2xl border border-zinc-200 bg-white p-5 text-sm text-zinc-800 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-200">
      {children}
    </section>
  );
}

const btnPrimary =
  "inline-flex items-center rounded-lg bg-zinc-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-zinc-700 disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300";
const btnSecondary =
  "inline-flex items-center rounded-lg border border-zinc-300 bg-white px-3 py-1.5 text-sm font-medium text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300 dark:hover:bg-zinc-800";
