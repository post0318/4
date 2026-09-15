"use client";

import { useEffect, useRef, useState } from "react";
import { useAppAuth } from "@/components/auth/AppAuth";
import type { BondLayoutInput } from "@/lib/cashflow/bondLayout";

interface ShareLinkButtonProps {
  /** 현재 현금흐름 입력값 — 링크에 담긴다 */
  value: BondLayoutInput;
}

/**
 * 현금흐름 공유 링크 생성 — 입력폼과 분리된 독립 버튼 (감사 ⑤ 중10).
 * 승인 계정만 만들 수 있다(서버 API 도 잠김). 로그인 전에 누르면 로그인 팝업을
 * 띄우고, 로그인이 끝나면 이어서 생성한다. 방식(서명형/서버저장형)과 고객 모드
 * (트레이딩 탭 숨김)는 버튼 옆에서 고른다.
 */
export function ShareLinkButton({ value }: ShareLinkButtonProps) {
  const auth = useAppAuth();
  const [method, setMethod] = useState<"signed" | "token">("signed");
  const [clientMode, setClientMode] = useState(true);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);

  // 로그인 팝업을 띄운 뒤 로그인이 끝나면 이어서 생성
  const pendingRef = useRef(false);
  const createRef = useRef<() => Promise<void>>(async () => {});
  useEffect(() => {
    if (pendingRef.current && auth.isSignedIn) {
      pendingRef.current = false;
      void createRef.current();
    }
  }, [auth.isSignedIn]);

  const create = async () => {
    if (busy) return;
    if (auth.enabled && !auth.isSignedIn) {
      pendingRef.current = true;
      setStatus("링크 생성은 로그인 후 가능합니다.");
      auth.openSignIn();
      return;
    }
    setBusy(true);
    setStatus("링크 생성 중…");
    try {
      const res = await fetch("/api/share-link", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ input: value, client: clientMode, method }),
      });
      let data: { url?: string; error?: string } = {};
      try {
        data = (await res.json()) as typeof data;
      } catch {
        /* 비JSON 응답 */
      }
      if (!res.ok || !data.url) {
        setStatus(
          res.status === 401
            ? "링크 생성은 로그인 후 가능합니다."
            : (data.error ?? `링크 생성 실패 (HTTP ${res.status})`)
        );
        return;
      }
      try {
        await navigator.clipboard.writeText(data.url);
        setStatus("링크를 클립보드에 복사했습니다.");
      } catch {
        setStatus(data.url);
      }
    } catch {
      setStatus("링크 생성 중 네트워크 오류가 났습니다.");
    } finally {
      setBusy(false);
    }
  };
  useEffect(() => {
    createRef.current = create;
  });

  return (
    <div className="flex flex-wrap items-center justify-end gap-2 print:hidden">
      {status && (
        <p className="mr-auto text-xs text-zinc-500 dark:text-zinc-400 sm:mr-2">{status}</p>
      )}
      <label className="inline-flex cursor-pointer items-center gap-1.5 text-xs text-zinc-600 dark:text-zinc-400">
        <input
          type="checkbox"
          checked={clientMode}
          onChange={(e) => setClientMode(e.target.checked)}
          className="h-3.5 w-3.5 rounded border-zinc-300 dark:border-zinc-600"
        />
        고객용(트레이딩 탭 숨김)
      </label>
      <span
        role="radiogroup"
        aria-label="링크 방식"
        className="inline-flex overflow-hidden rounded-lg border border-zinc-300 text-xs dark:border-zinc-700"
      >
        {(
          [
            ["signed", "서명형", "값을 봉인해 링크에 담음 · 저장소 불필요 · 회수 불가"],
            ["token", "서버저장형", "값은 서버에 두고 토큰만 링크에 · 짧음 · 회수·만료 가능"],
          ] as const
        ).map(([m, label, title]) => (
          <button
            key={m}
            type="button"
            role="radio"
            aria-checked={method === m}
            title={title}
            onClick={() => setMethod(m)}
            className={
              method === m
                ? "bg-zinc-800 px-2.5 py-1.5 font-medium text-white dark:bg-zinc-200 dark:text-zinc-900"
                : "bg-white px-2.5 py-1.5 text-zinc-600 hover:bg-zinc-50 dark:bg-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800"
            }
          >
            {label}
          </button>
        ))}
      </span>
      <button
        type="button"
        onClick={() => void create()}
        disabled={busy}
        className="inline-flex items-center gap-1.5 rounded-lg bg-zinc-900 px-3.5 py-1.5 text-sm font-medium text-white transition-colors hover:bg-zinc-700 disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
      >
        공유 링크 생성
      </button>
    </div>
  );
}
