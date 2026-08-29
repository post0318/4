"use client";

import { useMemo, useState } from "react";
import { fmtInt, fmtNum } from "@/lib/format";
import type { FxRates } from "@/lib/types";

/** 발송 대기 중인 종목 한 줄 (체크됨 + 수량 산출 완료) */
export interface PendingLine {
  isin: string;
  isinVerified: boolean;
  nameKo: string;
  namePt: string;
  maturityDate: string;
  couponRatePct: number;
  buyYieldPct: number;
  krwAmount: number;
  pu: number;
  quantity: number;
}

interface OrderReviewProps {
  lines: PendingLine[];
  /** 체크는 됐지만 원화투자금액 미입력 등으로 아직 계산 안 된 종목 수 */
  incompleteCount: number;
  fx: FxRates | null;
  defaultTo: string;
}

type SendState =
  | { status: "idle" }
  | { status: "sending" }
  | { status: "done"; delivered: boolean; to: string; subject: string; preview: string }
  | { status: "error"; message: string };

/**
 * 발송 전 확인 후 발송 (요구사항 5). 체크된 종목만 발송한다 (요구사항 4).
 */
export function OrderReview({ lines, incompleteCount, fx, defaultTo }: OrderReviewProps) {
  // 사용자가 수정하기 전까지는 기본 수신자(defaultTo, 뒤늦게 로드될 수 있음)를 따른다
  const [toOverride, setToOverride] = useState<string | null>(null);
  const to = toOverride ?? defaultTo;
  const [note, setNote] = useState("");
  const [modalOpen, setModalOpen] = useState(false);
  const [send, setSend] = useState<SendState>({ status: "idle" });

  // 주문 구성(종목·금액·수량)이 바뀌면 확인 체크가 자동으로 풀리도록 시그니처로 관리
  const signature = useMemo(
    () =>
      JSON.stringify(
        lines.map((l) => [l.maturityDate, l.krwAmount, l.quantity, l.pu])
      ),
    [lines]
  );
  const [confirmedSig, setConfirmedSig] = useState<string | null>(null);
  const confirmed = confirmedSig === signature;

  const emailValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to.trim());
  const canSend =
    lines.length > 0 && confirmed && emailValid && send.status !== "sending";

  const totalKrw = lines.reduce((s, l) => s + l.krwAmount, 0);

  async function doSend() {
    if (lines.length === 0 || !fx) return;
    setSend({ status: "sending" });
    setModalOpen(false);
    try {
      const res = await fetch("/api/send-order", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          lines,
          fx,
          to: to.trim(),
          confirmed: true,
          note: note.trim() || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setSend({ status: "error", message: data.error ?? "발송 실패" });
        return;
      }
      setSend({
        status: "done",
        delivered: data.delivered,
        to: data.to,
        subject: data.subject,
        preview: data.preview,
      });
      setConfirmedSig(null);
    } catch (e) {
      setSend({
        status: "error",
        message: e instanceof Error ? e.message : "발송 중 오류",
      });
    }
  }

  return (
    <section className="rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-950">
      <h2 className="mb-3 text-sm font-semibold text-zinc-900 dark:text-zinc-100">
        주문 확인 · 이메일 발송
      </h2>

      <div className="mb-3 rounded-lg bg-zinc-50 p-3 text-sm dark:bg-zinc-900">
        {lines.length === 0 ? (
          <p className="text-zinc-500 dark:text-zinc-400">
            발송할 종목이 없습니다. 표에서 종목을 체크하고 원화투자금액을 입력하세요.
          </p>
        ) : (
          <>
            <p className="font-medium text-zinc-900 dark:text-zinc-100">
              발송 대상 {lines.length}개 종목 · 원화투자금액 총액 ₩{" "}
              {fmtInt(totalKrw)}
            </p>
            <ul className="mt-1 space-y-0.5 text-xs text-zinc-600 dark:text-zinc-400">
              {lines.map((l) => (
                <li key={l.maturityDate}>
                  {l.nameKo} — {fmtInt(l.quantity)}좌 (₩ {fmtInt(l.krwAmount)})
                </li>
              ))}
            </ul>
            {incompleteCount > 0 && (
              <p className="mt-1 text-xs text-amber-600 dark:text-amber-400">
                체크했지만 금액 미입력/계산 불가한 종목 {incompleteCount}개는
                제외됩니다.
              </p>
            )}
          </>
        )}
      </div>

      <label className="block text-xs text-zinc-500 dark:text-zinc-400">
        수신자 이메일
      </label>
      <input
        type="email"
        value={to}
        onChange={(e) => setToOverride(e.target.value)}
        placeholder="orders@example.com"
        className="mt-1 w-full rounded-md border border-zinc-300 px-3 py-2 text-sm outline-none focus:border-blue-400 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100"
      />
      {!emailValid && to.length > 0 && (
        <p className="mt-1 text-[11px] text-red-500">
          이메일 주소 형식이 올바르지 않습니다.
        </p>
      )}

      <label className="mt-3 block text-xs text-zinc-500 dark:text-zinc-400">
        메모 (선택)
      </label>
      <textarea
        value={note}
        onChange={(e) => setNote(e.target.value)}
        rows={2}
        className="mt-1 w-full rounded-md border border-zinc-300 px-3 py-2 text-sm outline-none focus:border-blue-400 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100"
      />

      <label className="mt-3 flex items-start gap-2 text-sm text-zinc-700 dark:text-zinc-300">
        <input
          type="checkbox"
          checked={confirmed}
          disabled={lines.length === 0}
          onChange={(e) => setConfirmedSig(e.target.checked ? signature : null)}
          className="mt-0.5 h-4 w-4"
        />
        <span>
          환율·종목·수량·수신자 이메일을 모두 확인했습니다. 체크된 {lines.length}개
          종목을 이 내용으로 발송합니다.
        </span>
      </label>

      <button
        type="button"
        disabled={!canSend}
        onClick={() => setModalOpen(true)}
        className="mt-3 w-full rounded-md bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-zinc-300 dark:disabled:bg-zinc-700"
      >
        {send.status === "sending" ? "발송 중…" : "확인 후 발송"}
      </button>

      {send.status === "error" && (
        <p className="mt-3 rounded-md bg-red-50 px-3 py-2 text-xs text-red-600 dark:bg-red-950/40 dark:text-red-300">
          {send.message}
        </p>
      )}
      {send.status === "done" && (
        <div className="mt-3 rounded-md bg-emerald-50 px-3 py-2 text-xs text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300">
          <p className="font-semibold">
            {send.delivered
              ? `발송 완료 → ${send.to}`
              : `발송 준비 완료 (전송 미연동 · stub) → ${send.to}`}
          </p>
          <p className="mt-1 text-emerald-600 dark:text-emerald-400">
            제목: {send.subject}
          </p>
          <details className="mt-1">
            <summary className="cursor-pointer">본문 미리보기</summary>
            <pre className="mt-1 whitespace-pre-wrap break-all text-[11px] text-zinc-600 dark:text-zinc-400">
              {send.preview}
            </pre>
          </details>
        </div>
      )}

      {modalOpen && lines.length > 0 && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="max-h-[80vh] w-full max-w-md overflow-y-auto rounded-xl bg-white p-5 shadow-xl dark:bg-zinc-900">
            <h3 className="text-base font-semibold text-zinc-900 dark:text-zinc-100">
              이 내용으로 발송할까요?
            </h3>
            <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
              수신자 {to.trim()}
            </p>
            <ul className="mt-3 space-y-2">
              {lines.map((l) => (
                <li
                  key={l.maturityDate}
                  className="rounded-lg border border-zinc-200 p-2.5 text-sm dark:border-zinc-700"
                >
                  <p className="font-medium text-zinc-900 dark:text-zinc-100">
                    {l.nameKo}{" "}
                    <span className="text-xs font-normal text-zinc-400">
                      {l.isin}
                    </span>
                  </p>
                  <div className="mt-1 grid grid-cols-2 gap-x-3 gap-y-0.5 text-xs tabular-nums text-zinc-600 dark:text-zinc-400">
                    <span>매수수익률 연 {fmtNum(l.buyYieldPct, 2)}%</span>
                    <span>PU R$ {fmtNum(l.pu, 4)}</span>
                    <span>투자금액 ₩ {fmtInt(l.krwAmount)}</span>
                    <span className="font-bold text-blue-700 dark:text-blue-300">
                      매수수량 {fmtInt(l.quantity)}좌
                    </span>
                  </div>
                </li>
              ))}
            </ul>
            <p className="mt-3 text-[11px] text-zinc-400">
              발송 시 서버가 종목마다 환율·PU·수량을 다시 계산해 대조합니다. 값이
              크게 다르면 발송되지 않습니다.
            </p>
            <div className="mt-4 flex gap-2">
              <button
                type="button"
                onClick={() => setModalOpen(false)}
                className="flex-1 rounded-md border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800"
              >
                취소
              </button>
              <button
                type="button"
                onClick={doSend}
                className="flex-1 rounded-md bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700"
              >
                발송
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
