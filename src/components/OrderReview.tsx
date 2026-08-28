"use client";

import { useState } from "react";
import { fmtInt, fmtNum } from "@/lib/format";
import type { OrderPayload } from "@/lib/orderEmail";

interface OrderReviewProps {
  /** 주문 payload. null이면 아직 발송 불가(선행 입력 미완). */
  order: OrderPayload | null;
  defaultTo: string;
}

type SendState =
  | { status: "idle" }
  | { status: "sending" }
  | { status: "done"; delivered: boolean; to: string; subject: string; preview: string }
  | { status: "error"; message: string };

/**
 * 발송 전 확인 후 발송 (요구사항 5).
 * - 수신자 이메일: ORDER_EMAIL_TO 기본값 프리필, 수정 가능
 * - "입력 내용을 모두 확인했습니다" 체크 전에는 발송 버튼 비활성
 * - 발송 클릭 시 요약 모달로 한 번 더 확인
 */
export function OrderReview({ order, defaultTo }: OrderReviewProps) {
  const [to, setTo] = useState(defaultTo);
  const [confirmed, setConfirmed] = useState(false);
  const [note, setNote] = useState("");
  const [modalOpen, setModalOpen] = useState(false);
  const [send, setSend] = useState<SendState>({ status: "idle" });

  const emailValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to.trim());
  const canSend = !!order && confirmed && emailValid && send.status !== "sending";

  async function doSend() {
    if (!order) return;
    setSend({ status: "sending" });
    setModalOpen(false);
    try {
      const res = await fetch("/api/send-order", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          order: { ...order, note: note.trim() || undefined },
          to: to.trim(),
          confirmed: true,
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
      setConfirmed(false);
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

      <label className="block text-xs text-zinc-500 dark:text-zinc-400">
        수신자 이메일
      </label>
      <input
        type="email"
        value={to}
        onChange={(e) => setTo(e.target.value)}
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
          onChange={(e) => setConfirmed(e.target.checked)}
          className="mt-0.5 h-4 w-4"
        />
        <span>
          환율·종목·수량·수신자 이메일을 모두 확인했습니다. 이 내용으로 주문
          이메일을 발송합니다.
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

      {!order && (
        <p className="mt-2 text-[11px] text-zinc-400">
          환율·종목·투자금액을 모두 입력하면 발송할 수 있습니다.
        </p>
      )}

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

      {modalOpen && order && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-md rounded-xl bg-white p-5 shadow-xl dark:bg-zinc-900">
            <h3 className="text-base font-semibold text-zinc-900 dark:text-zinc-100">
              이 내용으로 발송할까요?
            </h3>
            <dl className="mt-3 space-y-1.5 text-sm">
              <ModalRow k="수신자" v={to.trim()} />
              <ModalRow k="종목" v={`${order.bond.nameKo} (${order.bond.isin ?? "-"})`} />
              <ModalRow k="매수수익률" v={`연 ${fmtNum(order.bond.buyYieldPct, 2)}%`} />
              <ModalRow k="매수단가 PU" v={`R$ ${fmtNum(order.amounts.pu, 4)}`} />
              <ModalRow k="원화투자금액" v={`₩ ${fmtInt(order.amounts.krwAmount)}`} />
              <ModalRow k="달러 환전액" v={`US$ ${fmtNum(order.amounts.usdAmount, 2)}`} />
              <ModalRow
                k="매수수량"
                v={`${fmtInt(order.amounts.quantity)} 좌`}
                strong
              />
              <ModalRow k="실매수금액" v={`R$ ${fmtNum(order.amounts.brlCost, 2)}`} />
            </dl>
            <p className="mt-3 text-[11px] text-zinc-400">
              발송 시 서버가 환율·PU·수량을 다시 계산해 대조합니다. 값이 크게
              다르면 발송되지 않습니다.
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

function ModalRow({ k, v, strong }: { k: string; v: string; strong?: boolean }) {
  return (
    <div className="flex justify-between gap-4">
      <dt className="text-zinc-500 dark:text-zinc-400">{k}</dt>
      <dd
        className={`tabular-nums text-zinc-900 dark:text-zinc-100 ${
          strong ? "font-bold" : "font-medium"
        }`}
      >
        {v}
      </dd>
    </div>
  );
}
