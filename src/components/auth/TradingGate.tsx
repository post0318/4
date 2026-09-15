"use client";

import { useState, type FormEvent } from "react";
import { isAllowedEmail, useAppAuth } from "@/components/auth/AppAuth";

interface TradingGateProps {
  /** 가입 가능한 회사 이메일 도메인 */
  allowedDomains: string[];
  /** `/?signup=1` 로 들어온 경우 가입 신청 폼을 바로 연다 */
  openSignup?: boolean;
}

/**
 * 트레이딩 탭 진입 문. 로그인 전에는 탭 내용 대신 이 화면이 보인다.
 *  - 로그인: Clerk 팝업(이메일·비밀번호, 비밀번호 찾기 포함)
 *  - 가입 신청: 우리 폼에서 회사 도메인을 먼저 검사한 뒤 Clerk 대기자 명단에 등록.
 *    관리자가 Clerk 대시보드에서 승인하면 본인에게 안내 메일이 간다.
 *  - 로그인했지만 회사 도메인이 아니면 거부 안내 (서버 API 도 같은 기준으로 거부)
 */
export function TradingGate({ allowedDomains, openSignup = false }: TradingGateProps) {
  const auth = useAppAuth();
  const [mode, setMode] = useState<"menu" | "signup" | "done">(openSignup ? "signup" : "menu");
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const domainsLabel = allowedDomains.map((d) => `@${d}`).join(", ");

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

  if (!auth.isLoaded) {
    return (
      <Box>
        <p className="text-sm text-zinc-500">로그인 상태 확인 중…</p>
      </Box>
    );
  }

  if (auth.isSignedIn && auth.email && !isAllowedEmail(auth.email, allowedDomains)) {
    return (
      <Box>
        <p className="font-medium text-red-700 dark:text-red-300">
          회사 이메일 계정만 트레이딩 탭을 쓸 수 있습니다.
        </p>
        <p className="mt-1 text-xs text-zinc-500">
          현재 계정 {auth.email} · 허용 도메인 {domainsLabel}
        </p>
        <button type="button" onClick={() => void auth.signOut()} className={btnSecondary}>
          로그아웃
        </button>
      </Box>
    );
  }

  const submitSignup = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    const addr = email.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(addr)) {
      setError("이메일 형식이 올바르지 않습니다.");
      return;
    }
    if (!isAllowedEmail(addr, allowedDomains)) {
      setError(`회사 이메일(${domainsLabel})만 가입할 수 있습니다.`);
      return;
    }
    setBusy(true);
    try {
      await auth.joinWaitlist(addr);
      setMode("done");
    } catch (err) {
      setError(err instanceof Error ? err.message : "가입 신청에 실패했습니다.");
    } finally {
      setBusy(false);
    }
  };

  if (mode === "done") {
    return (
      <Box>
        <p className="font-medium">가입 신청이 접수되었습니다.</p>
        <p className="mt-1 text-xs text-zinc-500">
          관리자가 승인하면 {email} 로 안내 메일이 갑니다. 메일의 안내대로 비밀번호를
          만든 뒤 로그인하세요.
        </p>
        <button type="button" onClick={() => setMode("menu")} className={btnSecondary}>
          돌아가기
        </button>
      </Box>
    );
  }

  if (mode === "signup") {
    return (
      <Box>
        <form onSubmit={submitSignup} className="flex flex-col gap-2">
          <p className="font-medium">가입 신청</p>
          <p className="text-xs text-zinc-500">
            회사 이메일({domainsLabel})만 가능합니다. 신청 후 관리자 승인이 필요합니다.
          </p>
          <input
            type="email"
            autoComplete="email"
            inputMode="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder={`이름@${allowedDomains[0] ?? "example.com"}`}
            className="w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 outline-none focus:border-zinc-500 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100"
            required
          />
          {error && (
            <p role="alert" className="text-xs text-red-600 dark:text-red-400">
              {error}
            </p>
          )}
          <div className="flex gap-2">
            <button type="submit" disabled={busy} className={btnPrimary}>
              {busy ? "신청 중…" : "신청"}
            </button>
            <button type="button" onClick={() => setMode("menu")} className={btnSecondary}>
              취소
            </button>
          </div>
        </form>
      </Box>
    );
  }

  return (
    <Box>
      <p className="font-medium">트레이딩 탭은 승인된 담당자만 사용할 수 있습니다.</p>
      <p className="mt-1 text-xs text-zinc-500">
        로그인하거나, 계정이 없으면 회사 이메일로 가입을 신청하세요.
      </p>
      <div className="mt-3 flex flex-wrap gap-2">
        <button type="button" onClick={auth.openSignIn} className={btnPrimary}>
          로그인
        </button>
        <button type="button" onClick={() => setMode("signup")} className={btnSecondary}>
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
  "mt-0 inline-flex items-center rounded-lg border border-zinc-300 bg-white px-3 py-1.5 text-sm font-medium text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300 dark:hover:bg-zinc-800";
