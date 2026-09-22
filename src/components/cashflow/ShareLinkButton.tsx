"use client";

import { useEffect, useRef, useState } from "react";
import { Link2 } from "lucide-react";
import { useAppAuth } from "@/components/auth/AppAuth";
import type { BondLayoutInput } from "@/lib/cashflow/bondLayout";

interface ShareLinkButtonProps {
  /** 현재 현금흐름 입력값 — 링크에 담긴다 */
  value: BondLayoutInput;
}

/**
 * 현금흐름 공유 링크 생성 — 탭 줄 오른쪽 끝의 독립 버튼 (트레이딩 탭과 같은 급).
 * 누르면 작은 패널이 열려 방식(서명형/서버저장형)·고객용 여부를 고르고 생성한다.
 * 승인 계정만 만들 수 있다(서버 API 도 잠김). 로그인 전이면 로그인 팝업을 띄우고,
 * 로그인이 끝나면 이어서 생성한다.
 */
export function ShareLinkButton({ value }: ShareLinkButtonProps) {
  const auth = useAppAuth();
  const [open, setOpen] = useState(false);
  const [method, setMethod] = useState<"signed" | "token">("signed");
  const [clientMode, setClientMode] = useState(true);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  // 바깥 클릭·Esc 로 닫기
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

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
      setStatus("로그인 후 생성됩니다.");
      auth.openSignIn();
      return;
    }
    setBusy(true);
    setStatus("생성 중…");
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
            ? "로그인 후 생성할 수 있습니다."
            : (data.error ?? `생성 실패 (HTTP ${res.status})`)
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
      setStatus("네트워크 오류가 났습니다.");
    } finally {
      setBusy(false);
    }
  };
  useEffect(() => {
    createRef.current = create;
  });

  return (
    <div ref={rootRef} className="relative print:hidden">
      {/* 테두리·배경 없이 탭 줄의 글자처럼 (오너 지시 2026-09-22) */}
      <button
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="inline-flex items-center gap-1.5 rounded-lg px-3.5 py-1.5 text-sm font-medium text-zinc-500 transition-colors hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100"
      >
        <Link2 aria-hidden="true" className="size-3.5 shrink-0" />
        공유 링크
      </button>

      {open && (
        <div
          role="dialog"
          aria-label="공유 링크 생성"
          className="absolute right-0 z-30 mt-2 w-72 rounded-xl border border-zinc-200 bg-white p-3 text-sm shadow-lg dark:border-zinc-700 dark:bg-zinc-900"
        >
          <p className="mb-2 text-xs font-medium text-zinc-500 dark:text-zinc-400">링크 방식</p>
          <div role="radiogroup" aria-label="링크 방식" className="mb-3 grid grid-cols-2 gap-1.5">
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
                    ? "rounded-lg bg-zinc-800 px-2.5 py-1.5 text-xs font-medium text-white dark:bg-zinc-200 dark:text-zinc-900"
                    : "rounded-lg border border-zinc-300 bg-white px-2.5 py-1.5 text-xs text-zinc-600 hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800"
                }
              >
                {label}
              </button>
            ))}
          </div>
          <label className="mb-3 flex cursor-pointer items-center gap-2 text-xs text-zinc-600 dark:text-zinc-400">
            <input
              type="checkbox"
              checked={clientMode}
              onChange={(e) => setClientMode(e.target.checked)}
              className="h-3.5 w-3.5 rounded border-zinc-300 dark:border-zinc-600"
            />
            고객용 (트레이딩 탭 숨김 · 인쇄·복사 차단)
          </label>
          <button
            type="button"
            onClick={() => void create()}
            disabled={busy}
            className="w-full rounded-lg bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-500 disabled:opacity-50"
          >
            {busy ? "생성 중…" : "링크 생성 · 복사"}
          </button>
          {status && (
            <p className="mt-2 break-all text-xs text-zinc-500 dark:text-zinc-400">{status}</p>
          )}
        </div>
      )}
    </div>
  );
}
