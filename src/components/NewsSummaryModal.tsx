"use client";

import { useEffect, useState } from "react";

export interface SummaryTarget {
  link: string;
  sig?: string;
  /** 영문 원제(요약 생성 입력) */
  title: string;
  /** 목록의 자동 번역 제목(요약이 없을 때 보여준다) */
  titleKo: string;
  source: string;
}

interface Summary {
  titleKo: string;
  bullets: string[];
  url: string;
  /** other = 원문을 못 읽어 같은 사건의 다른 매체 기사로 요약 */
  basis?: "article" | "other" | "link";
  sources?: { url: string; source: string }[];
}

type State =
  | { kind: "loading" }
  | { kind: "ok"; summary: Summary }
  | { kind: "none"; reason: string };

const REASON_TEXT: Record<string, string> = {
  pending: "요약을 준비 중입니다. 잠시 후 다시 열어 보세요.",
  unreadable: "원문을 읽을 수 없는 기사입니다(유료 구독·접근 차단 등).",
  quota: "오늘은 요약 한도에 도달했습니다.",
  error: "요약을 불러오지 못했습니다.",
};

/** 글로벌 뉴스 클릭 팝업 — 한글 제목 + 요약 + 원문 링크 (/api/news-summary) */
export function NewsSummaryModal({
  target,
  onClose,
}: {
  target: SummaryTarget;
  onClose: () => void;
}) {
  const [state, setState] = useState<State>({ kind: "loading" });

  useEffect(() => {
    const ctrl = new AbortController();
    fetch("/api/news-summary", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ link: target.link, sig: target.sig, title: target.title }),
      signal: ctrl.signal,
    })
      .then((r) => r.json())
      .then((d: { ok: boolean; summary?: Summary; reason?: string }) =>
        setState(
          d.ok && d.summary
            ? { kind: "ok", summary: d.summary }
            : { kind: "none", reason: d.reason ?? "error" }
        )
      )
      .catch((e: unknown) => {
        if (!(e instanceof DOMException && e.name === "AbortError")) {
          setState({ kind: "none", reason: "error" });
        }
      });
    return () => ctrl.abort();
  }, [target]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const url = state.kind === "ok" ? state.summary.url : target.link;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="news-summary-title"
        className="max-h-[85vh] w-full max-w-lg overflow-y-auto rounded-xl border border-zinc-200 bg-white p-5 shadow-xl dark:border-zinc-800 dark:bg-zinc-950"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3">
          <h3
            id="news-summary-title"
            className="text-sm font-semibold text-zinc-900 dark:text-zinc-100"
          >
            {state.kind === "ok" ? state.summary.titleKo : target.titleKo}
          </h3>
          <button
            type="button"
            onClick={onClose}
            aria-label="닫기"
            className="-mr-1 -mt-1 rounded px-1.5 text-lg leading-none text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200"
          >
            ×
          </button>
        </div>
        <p className="mt-1 text-[11px] text-zinc-400">{target.source}</p>

        <div className="mt-3 text-xs text-zinc-700 dark:text-zinc-300">
          {state.kind === "loading" && (
            <p className="text-zinc-500 dark:text-zinc-400">요약을 불러오는 중…</p>
          )}
          {state.kind === "ok" && state.summary.basis === "other" && (
            <p className="mb-2 rounded bg-amber-50 px-2 py-1 text-[11px] text-amber-800 dark:bg-amber-900/30 dark:text-amber-300">
              원문(유료 구독·접근 차단)을 읽을 수 없어 같은 사건을 다룬 다른 매체 보도로
              요약했습니다
              {state.summary.sources?.length ? (
                <>
                  {" — "}
                  {state.summary.sources.map((s, i) => (
                    <span key={s.url}>
                      {i > 0 && ", "}
                      <a
                        href={s.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="underline"
                      >
                        {s.source}
                      </a>
                    </span>
                  ))}
                </>
              ) : null}
            </p>
          )}
          {state.kind === "ok" && (
            <ul className="space-y-1.5">
              {state.summary.bullets.map((b, i) => (
                <li key={i} className="flex gap-1.5">
                  <span className="text-zinc-400">•</span>
                  <span>{b}</span>
                </li>
              ))}
            </ul>
          )}
          {state.kind === "none" && (
            <p className="text-zinc-500 dark:text-zinc-400">
              {REASON_TEXT[state.reason] ?? REASON_TEXT.error}
            </p>
          )}
        </div>

        <p className="mt-4 border-t border-zinc-100 pt-2 text-[11px] text-zinc-400 dark:border-zinc-800">
          {state.kind === "ok" && "AI 요약(Gemini) — 원문과 다를 수 있습니다. "}
          <a
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            className="text-blue-600 hover:underline dark:text-blue-400"
          >
            원문 보기 →
          </a>
        </p>
      </div>
    </div>
  );
}
