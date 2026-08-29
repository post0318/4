import { NextRequest, NextResponse } from "next/server";
import {
  buildOrderEmail,
  DEFAULT_GREETING,
  DEFAULT_SIGNATURE,
  type OrderEmailData,
  type OrderEmailLine,
} from "@/lib/orderEmail";
import {
  computeNtnfPu,
  getOrderSettlementDate,
  toISODate,
  today,
} from "@/lib/ntnfPricing";
import { computeOrder, isValidOrderInputs } from "@/lib/quantity";

export const runtime = "nodejs";

/**
 * 매수 주문 이메일 발송 (요구사항 4·5).
 *
 * 체크된 종목(1개 이상)만 발송 대상이다. 클라이언트가 보낸 PU·수량을 신뢰하지 않고
 * 종목마다 서버에서 다시 계산해 대조한다. 불일치가 크면 422로 거부한다.
 *
 * 실제 전송은 현재 stub — sendEmail() 어댑터에 Resend API 또는 Gmail SMTP
 * (nodemailer)를 연결하면 된다.
 */

const DEFAULT_TO = process.env.ORDER_EMAIL_TO ?? "";
// 환경변수는 리터럴 "\n"을 줄바꿈으로 해석한다
const GREETING =
  process.env.ORDER_EMAIL_GREETING?.replace(/\\n/g, "\n") ?? DEFAULT_GREETING;
const SIGNATURE = process.env.ORDER_EMAIL_SIGNATURE ?? DEFAULT_SIGNATURE;

interface IncomingLine {
  isin: string;
  isinVerified: boolean;
  nameKo: string;
  namePt: string;
  maturityDate: string;
  buyYieldPct: number;
  krwAmount: number;
  pu: number;
  /** 클라이언트가 계산한 매수가능수량 (대조용) */
  quantity: number;
  /** 사용자가 지정한 실제 주문수량 */
  orderQuantity: number;
}

interface SendOrderBody {
  lines: IncomingLine[];
  fx: { usdKrw: number; usdBrl: number; krwBrl: number; asOf: string | null };
  to: string;
  confirmed: boolean;
  note?: string;
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

  const { lines, fx, to, confirmed, note } = body ?? {};

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

  if (!Array.isArray(lines) || lines.length === 0) {
    return NextResponse.json(
      { error: "체크된 종목이 없습니다. 발송할 종목을 선택하세요." },
      { status: 400 }
    );
  }

  if (!fx || typeof fx.usdKrw !== "number" || typeof fx.usdBrl !== "number") {
    return NextResponse.json({ error: "환율 정보가 없습니다." }, { status: 400 });
  }

  const settlement = getOrderSettlementDate();
  const settlementDate = toISODate(settlement);

  const resultLines: OrderEmailLine[] = [];
  const mismatches: unknown[] = [];

  for (const line of lines) {
    if (!line?.maturityDate || typeof line.buyYieldPct !== "number") {
      return NextResponse.json(
        { error: `종목 정보가 불완전합니다: ${line?.nameKo ?? line?.isin ?? "?"}` },
        { status: 400 }
      );
    }

    const pu = computeNtnfPu(line.maturityDate, line.buyYieldPct, settlement);
    if (pu === null) {
      return NextResponse.json(
        { error: `PU를 계산할 수 없습니다: ${line.nameKo}` },
        { status: 422 }
      );
    }

    const inputs = {
      krwAmount: line.krwAmount,
      usdKrw: fx.usdKrw,
      usdBrl: fx.usdBrl,
      pu,
    };
    if (!isValidOrderInputs(inputs)) {
      return NextResponse.json(
        { error: `주문 입력값이 올바르지 않습니다: ${line.nameKo}` },
        { status: 422 }
      );
    }

    const r = computeOrder(inputs);
    const puMismatch = Math.abs(pu - line.pu) / pu > 0.005;
    const qtyMismatch = r.quantity !== line.quantity;
    if (puMismatch || qtyMismatch) {
      mismatches.push({
        nameKo: line.nameKo,
        server: { pu, quantity: r.quantity },
        client: { pu: line.pu, quantity: line.quantity },
      });
      continue;
    }

    const orderQuantity = Math.trunc(line.orderQuantity);
    if (
      !Number.isFinite(orderQuantity) ||
      orderQuantity < 1 ||
      orderQuantity > r.quantity
    ) {
      return NextResponse.json(
        {
          error: `실제 주문수량이 올바르지 않습니다: ${line.nameKo} (1~${r.quantity}좌)`,
        },
        { status: 422 }
      );
    }

    resultLines.push({
      isin: line.isin,
      isinVerified: line.isinVerified,
      maturityDate: line.maturityDate,
      usdAmount: r.usdAmount,
      quantity: orderQuantity,
    });
  }

  if (mismatches.length > 0) {
    return NextResponse.json(
      {
        error: "서버 재계산 결과가 화면 값과 다릅니다. 새로고침 후 다시 시도하세요.",
        mismatches,
        settlementDate,
      },
      { status: 422 }
    );
  }

  const emailData: OrderEmailData = {
    orderDate: toISODate(today()),
    greeting: GREETING,
    signature: SIGNATURE,
    lines: resultLines,
    note: note?.trim() || undefined,
  };

  const { subject, text, html } = buildOrderEmail(emailData);
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
    lines: resultLines,
    preview: text,
  });
}

export async function GET() {
  return NextResponse.json({ defaultTo: DEFAULT_TO });
}
