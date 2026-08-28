import { NextRequest, NextResponse } from "next/server";
import { buildOrderEmail, type OrderPayload } from "@/lib/orderEmail";
import { computeNtnfPu, getOrderSettlementDate, toISODate } from "@/lib/ntnfPricing";
import { computeOrder, isValidOrderInputs } from "@/lib/quantity";

export const runtime = "nodejs";

/**
 * 매수 주문 이메일 발송 (요구사항 4·5).
 *
 * 클라이언트가 보낸 수량/PU를 신뢰하지 않고 서버에서 다시 계산해 대조한다
 * (신뢰 경계). 불일치가 크면 422로 거부한다.
 *
 * 실제 전송은 현재 stub이다 — sendEmail() 어댑터에 Resend API 또는 Gmail SMTP
 * (nodemailer)를 연결하면 된다. 지금은 본문을 서버 로그로 남기고
 * delivered:false 로 응답한다.
 */

const DEFAULT_TO = process.env.ORDER_EMAIL_TO ?? "";

interface SendOrderBody {
  order: OrderPayload;
  to: string;
  confirmed: boolean;
}

async function sendEmail(params: {
  to: string;
  subject: string;
  text: string;
  html: string;
}): Promise<{ delivered: boolean; provider: string }> {
  void params;
  // TODO: 실제 전송 연결 지점.
  //  - Resend:  const { Resend } = await import("resend");
  //             await new Resend(process.env.RESEND_API_KEY).emails.send({
  //               from: process.env.ORDER_EMAIL_FROM!, to, subject, text, html });
  //  - Gmail :  const nodemailer = await import("nodemailer"); SMTP + 앱 비밀번호
  return { delivered: false, provider: "stub" };
}

export async function POST(request: NextRequest) {
  let body: SendOrderBody;
  try {
    body = (await request.json()) as SendOrderBody;
  } catch {
    return NextResponse.json({ error: "잘못된 요청 본문" }, { status: 400 });
  }

  const { order, to, confirmed } = body ?? {};

  if (!confirmed) {
    return NextResponse.json(
      { error: "발송 전 확인 체크가 필요합니다." },
      { status: 400 }
    );
  }

  const recipient = (to || DEFAULT_TO).trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recipient)) {
    return NextResponse.json(
      { error: "수신자 이메일 주소가 올바르지 않습니다." },
      { status: 400 }
    );
  }

  if (!order?.bond?.maturityDate || !order?.amounts || !order?.fx) {
    return NextResponse.json({ error: "주문 정보가 불완전합니다." }, { status: 400 });
  }

  // --- 서버 재계산으로 대조 ---
  const settlement = getOrderSettlementDate();
  const pu = computeNtnfPu(order.bond.maturityDate, order.bond.buyYieldPct, settlement);
  if (pu === null) {
    return NextResponse.json(
      { error: "서버에서 매수단가(PU)를 계산할 수 없습니다." },
      { status: 422 }
    );
  }

  const inputs = {
    krwAmount: order.amounts.krwAmount,
    usdKrw: order.fx.usdKrw,
    usdBrl: order.fx.usdBrl,
    pu,
  };
  if (!isValidOrderInputs(inputs)) {
    return NextResponse.json({ error: "주문 입력값이 올바르지 않습니다." }, { status: 422 });
  }

  const recomputed = computeOrder(inputs);

  const puMismatch = Math.abs(pu - order.amounts.pu) / pu > 0.005; // 0.5%
  const qtyMismatch = recomputed.quantity !== order.amounts.quantity;
  if (puMismatch || qtyMismatch) {
    return NextResponse.json(
      {
        error: "서버 재계산 결과가 화면 값과 다릅니다. 새로고침 후 다시 시도하세요.",
        server: { pu, quantity: recomputed.quantity, settlementDate: toISODate(settlement) },
        client: { pu: order.amounts.pu, quantity: order.amounts.quantity },
      },
      { status: 422 }
    );
  }

  // --- 서버 계산값으로 최종 본문 구성 ---
  const finalOrder: OrderPayload = {
    ...order,
    settlementDate: toISODate(settlement),
    amounts: {
      ...order.amounts,
      pu,
      quantity: recomputed.quantity,
      usdAmount: recomputed.usdAmount,
      brlAmount: recomputed.brlAmount,
      brlCost: recomputed.brlCost,
      usdCost: recomputed.usdCost,
      krwCost: recomputed.krwCost,
      brlLeftover: recomputed.brlLeftover,
      krwLeftover: recomputed.krwLeftover,
    },
  };

  const { subject, text, html } = buildOrderEmail(finalOrder);

  const result = await sendEmail({ to: recipient, subject, text, html });

  if (!result.delivered) {
    console.log(
      `\n───── [send-order STUB] 미전송 ─────\nTo: ${recipient}\nSubject: ${subject}\n\n${text}\n───────────────────────────────────\n`
    );
  }

  return NextResponse.json({
    ok: true,
    delivered: result.delivered,
    provider: result.provider,
    to: recipient,
    subject,
    order: finalOrder,
    preview: text,
  });
}

export async function GET() {
  return NextResponse.json({ defaultTo: DEFAULT_TO });
}
