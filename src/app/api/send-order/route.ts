import { NextRequest, NextResponse } from "next/server";
import {
  buildOrderEmail,
  DEFAULT_GREETING,
  DEFAULT_SIGNATURE,
  DEFAULT_SUBJECT_PREFIX,
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
import { allValidEmails, parseRecipients } from "@/lib/recipients";
import { BOUNDS } from "@/lib/server/sanity";
import { getLatestNtnF } from "@/lib/server/brazilBondData";
import { fetchFxRate } from "@/lib/server/fxRate";
import { truncDecimals } from "@/lib/format";
import {
  allowedEmailDomains,
  isAllowedEmail,
  requireTradingUser,
} from "@/lib/server/appAuth";

export const runtime = "nodejs";

// 요청 본문 검증 상한/형식 (감사 ⑤ 낮음)
const MAX_LINES = 20;
const MAX_NOTE_LENGTH = 500;
const ISIN_RE = /^[A-Z]{2}[A-Z0-9]{9}\d$/;
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const inBounds = (v: number, [lo, hi]: readonly [number, number]) =>
  Number.isFinite(v) && v >= lo && v <= hi;
/** 매수수익률 대조 허용오차(%p). 스냅샷 금리는 0.01%p 단위라 사실상 완전일치 검사. */
const YIELD_EPSILON = 0.0001;
/** 달러 합계 대사 허용오차 — 2자리 절사 후 비교(화면과 같은 규칙) */
const USD_TOTAL_EPSILON = 0.005;
/**
 * 화면이 보낸 환율과 서버가 직접 조회한 시세의 허용 차이(비율).
 * 고시환율은 사용자가 고쳐 넣는 값이라 완전 고정할 수 없지만, 오타·뭵은
 * 탭은 이 폭을 벗어난다. 시세 조회가 실패하면 검사를 건너뛰고 발송은 막지 않는다.
 */
const FX_TOLERANCE = 0.05;

/**
 * 매수 주문 이메일 발송 (요구사항 4·5).
 *
 * 체크된 종목(1개 이상)만 발송 대상이다. 클라이언트가 보낸 PU·수량을 신뢰하지 않고
 * 종목마다 서버에서 다시 계산해 대조한다. 불일치가 크면 422로 거부한다.
 *
 * 실제 전송은 현재 stub — sendEmail() 어댑터에 Resend API 또는 Gmail SMTP
 * (nodemailer)를 연결하면 된다.
 */

// 기본 수신자/참조는 환경변수(ORDER_EMAIL_TO / ORDER_EMAIL_CC)에서만 읽는다.
// 실제 주소를 소스에 두지 않는다(감사 ⑤ 치명2 — 저장소·GET 응답으로 노출됐음).
// 미설정이면 빈 값 → 화면에서 직접 입력해야 발송된다. 여러 명은 ; 로 구분.
const DEFAULT_TO = process.env.ORDER_EMAIL_TO ?? "";
const DEFAULT_CC = process.env.ORDER_EMAIL_CC ?? "";
// 테스트 발송 수신자 — 실제 수신자 대신 개발자 본인 주소로만 보낸다.
const TEST_TO = process.env.ORDER_EMAIL_TEST_TO || process.env.ORDER_EMAIL_FROM || "";
// 환경변수는 리터럴 "\n"을 줄바꿈으로 해석한다
const GREETING =
  process.env.ORDER_EMAIL_GREETING?.replace(/\\n/g, "\n") ?? DEFAULT_GREETING;
const SIGNATURE = process.env.ORDER_EMAIL_SIGNATURE ?? DEFAULT_SIGNATURE;
const SUBJECT_PREFIX =
  process.env.ORDER_EMAIL_SUBJECT_PREFIX ?? DEFAULT_SUBJECT_PREFIX;

interface IncomingLine {
  isin: string;
  isinVerified: boolean;
  nameKo: string;
  namePt: string;
  maturityDate: string;
  buyYieldPct: number;
  /** 종목별 원화투자금액 — 환전 원화금액과 합계 대사 */
  krwAmount: number;
  /** 달러 환전액 (USD 송금액) — 자동값 또는 사용자 수정값 */
  usdAmount: number;
  pu: number;
  /** 클라이언트가 계산한 매수가능수량 (대조용) */
  quantity: number;
  /** 사용자가 지정한 실제 주문수량 */
  orderQuantity: number;
  /** 수량계산 안전 버퍼(%) */
  bufferPct?: number;
}

interface SendOrderBody {
  lines: IncomingLine[];
  fx: { usdKrw: number; usdBrl: number; krwBrl: number; asOf: string | null };
  to: string;
  cc?: string;
  confirmed: boolean;
  /** 환전금액 합계 — 종목별 합계와 대사(0 이면 화면과 같이 건너뜀) */
  exchange?: { krwTotal: number; usdTotal: number };
  note?: string;
  /** 테스트 발송 — 실제 수신자 대신 개발자 주소로만 보낸다 */
  testSend?: boolean;
  /** 테스트 발송 수신 주소 (없으면 ORDER_EMAIL_TEST_TO 환경변수) */
  testTo?: string;
}

async function sendEmail(params: {
  to: string[];
  cc: string[];
  subject: string;
  text: string;
  html: string;
}): Promise<{ delivered: boolean; provider: string }> {
  void params;
  // TODO: 실제 전송 연결 지점. (params.to / params.cc 는 주소 배열)
  //  - Resend:  const { Resend } = await import("resend");
  //             await new Resend(process.env.RESEND_API_KEY).emails.send({
  //               from: process.env.ORDER_EMAIL_FROM!, to, cc, subject, text, html });
  //  - Gmail :  const nodemailer = await import("nodemailer"); SMTP + 앱 비밀번호
  return { delivered: false, provider: "stub" };
}

export async function POST(request: NextRequest) {
  // 승인된 회사 계정만 (감사 ⑤ 치명1)
  const who = await requireTradingUser();
  if (!who.ok) return NextResponse.json({ error: who.error }, { status: who.status });

  let body: SendOrderBody;
  try {
    body = (await request.json()) as SendOrderBody;
  } catch {
    return NextResponse.json({ error: "잘못된 요청 본문" }, { status: 400 });
  }

  const { lines, fx, to, cc, confirmed, note, testSend, testTo, exchange } =
    body ?? {};

  if (!confirmed) {
    return NextResponse.json(
      { error: "발송 전 확인 체크가 필요합니다." },
      { status: 400 }
    );
  }

  // 테스트 발송이면 실제 수신자·참조를 무시하고 개발자 주소로만 보낸다.
  let toList: string[];
  let ccList: string[];
  if (testSend) {
    // 요청에 주소가 있으면 그것, 없으면 환경변수
    const typedTestTo = testTo?.trim();
    toList = parseRecipients(typedTestTo || TEST_TO);
    ccList = [];
    if (toList.length === 0 || !allValidEmails(toList)) {
      return NextResponse.json(
        {
          error: typedTestTo
            ? "테스트 발송 이메일 주소가 올바르지 않습니다."
            : "테스트 발송 주소가 없습니다. 이메일을 입력하거나 환경변수 ORDER_EMAIL_TEST_TO 를 지정하세요.",
        },
        { status: 422 }
      );
    }
    // 화면에서 직접 입력한 주소는 회사 도메인(ALLOWED_EMAIL_DOMAINS) 또는 관리자
    // 목록(ADMIN_EMAILS)으로 제한한다 — 주문 내용(종목·금액·수량)이 외부 주소로
    // 나가지 않게(감사 ⑤ 높음3). 환경변수 ORDER_EMAIL_TEST_TO 는 서버 설정이라
    // 그대로 둔다.
    if (typedTestTo) {
      const blocked = toList.filter((addr) => !isAllowedEmail(addr));
      if (blocked.length > 0) {
        const domains = allowedEmailDomains().map((d) => `@${d}`).join(", ");
        return NextResponse.json(
          {
            error: `테스트 발송은 회사 이메일(${domains}) 또는 관리자 주소로만 보낼 수 있습니다: ${blocked.join(", ")}`,
          },
          { status: 403 }
        );
      }
    }
  } else {
    // 받는사람·참조는 ; 또는 , 로 여러 명 지정 가능. "이름 <a@b.com>" 형식 허용.
    toList = parseRecipients(to || DEFAULT_TO);
    if (!allValidEmails(toList)) {
      return NextResponse.json(
        { error: "받는사람 이메일 주소가 올바르지 않습니다." },
        { status: 400 }
      );
    }
    ccList = parseRecipients(cc ?? DEFAULT_CC);
    if (ccList.length > 0 && !allValidEmails(ccList)) {
      return NextResponse.json(
        { error: "참조 이메일 주소가 올바르지 않습니다." },
        { status: 400 }
      );
    }
  }
  const recipient = toList.join(", ");

  if (!Array.isArray(lines) || lines.length === 0) {
    return NextResponse.json(
      { error: "체크된 종목이 없습니다. 발송할 종목을 선택하세요." },
      { status: 400 }
    );
  }
  // 입력 상한·형식 검증(감사 ⑤ 낮음). NTN-F는 만기가 10개 남짓이라 20줄이면 충분.
  if (lines.length > MAX_LINES) {
    return NextResponse.json(
      { error: `종목 수가 너무 많습니다 (최대 ${MAX_LINES}개).` },
      { status: 400 }
    );
  }
  if (note != null && (typeof note !== "string" || note.length > MAX_NOTE_LENGTH)) {
    return NextResponse.json(
      { error: `메모는 ${MAX_NOTE_LENGTH}자 이내의 문자열이어야 합니다.` },
      { status: 400 }
    );
  }

  if (!fx || typeof fx.usdKrw !== "number" || typeof fx.usdBrl !== "number") {
    return NextResponse.json({ error: "환율 정보가 없습니다." }, { status: 400 });
  }
  if (
    !inBounds(fx.usdKrw, BOUNDS.usdKrw) ||
    !inBounds(fx.usdBrl, BOUNDS.usdBrl)
  ) {
    return NextResponse.json(
      { error: "환율 값이 정상 범위를 벗어났습니다. 새로고침 후 다시 시도하세요." },
      { status: 400 }
    );
  }

  // 환전금액은 화면이 항상 보낸다. 빠진 요청은 합계 대사를 통짜로 건너뛰게
  // 되므로 받을 때 막는다(감사 ⑤ 중2 의 빈틈).
  if (
    !exchange ||
    typeof exchange !== "object" ||
    !Number.isFinite(Number(exchange.krwTotal)) ||
    !Number.isFinite(Number(exchange.usdTotal)) ||
    Number(exchange.krwTotal) < 0 ||
    Number(exchange.usdTotal) < 0
  ) {
    return NextResponse.json(
      { error: "환전금액 정보가 없거나 올바르지 않습니다." },
      { status: 400 }
    );
  }

  // 매수수익률은 스냅샷과 대조하면서 환율은 화면 값을 그대로 써서,
  // "서버 재계산"이 사실상 내부 일관성 검사에 그치던 것을 보완한다.
  // 고시환율은 사용자가 고치는 값이라 ±FX_TOLERANCE 만큼만 허용한다.
  const [marketUsdKrw, marketUsdBrl] = await Promise.all([
    fetchFxRate("USD", "KRW"),
    fetchFxRate("USD", "BRL"),
  ]);
  const farFromMarket = (client: number, market: number | null) =>
    market != null && market > 0 && Math.abs(client - market) / market > FX_TOLERANCE;
  if (
    farFromMarket(fx.usdKrw, marketUsdKrw) ||
    farFromMarket(fx.usdBrl, marketUsdBrl)
  ) {
    return NextResponse.json(
      {
        error: `환율이 시세와 너무 다릅니다(허용 ±${FX_TOLERANCE * 100}%). 입력한 고시환율을 확인하세요.`,
        market: { usdKrw: marketUsdKrw, usdBrl: marketUsdBrl },
        client: { usdKrw: fx.usdKrw, usdBrl: fx.usdBrl },
      },
      { status: 422 }
    );
  }

  const settlement = getOrderSettlementDate();
  const settlementDate = toISODate(settlement);

  // 서버가 직접 스냅샷을 열어 만기일→매수수익률(실시간 호가 > 전일 CSV, 화면과 같은 값)을 확인한다. 예전에는
  // 화면이 보낸 금리로 PU 를 계산한 뒤 같은 화면 값과 비교해 언제나 통과했다
  // (감사 ⑤ 중2). 묵은 탭·없는 종목·조작된 금리가 모두 여기서 걸린다.
  const snapshot = getLatestNtnF();
  const snapshotYield = new Map<string, number>();
  const snapshotQuoteDate = new Map<string, string>();
  for (const b of snapshot.items) {
    if (typeof b.buyRate === "number") snapshotYield.set(b.maturityDate, b.buyRate);
    if (b.quoteDate) snapshotQuoteDate.set(b.maturityDate, b.quoteDate);
  }

  const resultLines: OrderEmailLine[] = [];
  const mismatches: unknown[] = [];
  let krwSum = 0;
  let usdSum = 0;

  for (const line of lines) {
    if (!line?.maturityDate || typeof line.buyYieldPct !== "number") {
      return NextResponse.json(
        { error: `종목 정보가 불완전합니다: ${line?.nameKo ?? line?.isin ?? "?"}` },
        { status: 400 }
      );
    }
    if (typeof line.maturityDate !== "string" || !ISO_DATE_RE.test(line.maturityDate)) {
      return NextResponse.json(
        { error: `만기일 형식이 올바르지 않습니다: ${String(line.maturityDate)}` },
        { status: 400 }
      );
    }
    if (line.isin != null && line.isin !== "" && (typeof line.isin !== "string" || !ISIN_RE.test(line.isin))) {
      return NextResponse.json(
        { error: `ISIN 형식이 올바르지 않습니다: ${String(line.isin)}` },
        { status: 400 }
      );
    }

    // 스냅샷에 있는 종목인가 + 화면이 보낸 금리가 스냅샷과 같은가
    const snapYield = snapshotYield.get(line.maturityDate);
    if (snapYield === undefined) {
      return NextResponse.json(
        {
          error: `시세 스냅샷에 없는 종목입니다: ${line.nameKo ?? line.maturityDate} (만기 ${line.maturityDate})`,
        },
        { status: 422 }
      );
    }
    if (Math.abs(snapYield - line.buyYieldPct) > YIELD_EPSILON) {
      return NextResponse.json(
        {
          error: `매수수익률이 서버 시세와 다릅니다: ${line.nameKo ?? line.maturityDate} (화면 ${line.buyYieldPct}% / 서버 ${snapYield}%, 기준일 ${snapshotQuoteDate.get(line.maturityDate) ?? snapshot.asOfDate}). 새로고침 후 다시 시도하세요.`,
        },
        { status: 409 }
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
      usdAmount: line.usdAmount,
      usdKrw: fx.usdKrw,
      usdBrl: fx.usdBrl,
      pu,
      bufferPct: line.bufferPct ?? 0,
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

    krwSum += Number(line.krwAmount) || 0;
    usdSum += Number(line.usdAmount) || 0;

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

  // 환전금액 합계 대사 (PRD §5). 화면에서만 하던 검사를 서버도 한다 — 직접 POST 로
  // 우회할 수 없게(감사 ⑤ 중2). 환전금액을 입력하지 않은 경우(0)는 화면과 같이
  // 건너뛰되, 필드 자체가 없는 요청은 위에서 이미 400 으로 돌려보냈다.
  const exKrw = Number(exchange?.krwTotal) || 0;
  const exUsd = Number(exchange?.usdTotal) || 0;
  if (exKrw > 0 && Math.round(krwSum) !== Math.round(exKrw)) {
    return NextResponse.json(
      {
        error: `종목별 원화투자금액 합계(${Math.round(krwSum).toLocaleString("ko-KR")}원)가 환전 원화금액(${Math.round(exKrw).toLocaleString("ko-KR")}원)과 다릅니다.`,
      },
      { status: 422 }
    );
  }
  if (
    exUsd > 0 &&
    Math.abs(truncDecimals(usdSum, 2) - truncDecimals(exUsd, 2)) >= USD_TOTAL_EPSILON
  ) {
    return NextResponse.json(
      {
        error: `종목별 달러금액 합계($${truncDecimals(usdSum, 2)})가 환전 달러금액($${truncDecimals(exUsd, 2)})과 다릅니다.`,
      },
      { status: 422 }
    );
  }

  const emailData: OrderEmailData = {
    orderDate: toISODate(today()),
    greeting: GREETING,
    signature: SIGNATURE,
    subjectPrefix: SUBJECT_PREFIX,
    lines: resultLines,
    note: note?.trim() || undefined,
  };

  const built = buildOrderEmail(emailData);
  const subject = testSend ? `[테스트] ${built.subject}` : built.subject;
  const result = await sendEmail({
    to: toList,
    cc: ccList,
    subject,
    text: built.text,
    html: built.html,
  });
  const text = built.text;

  const ccLine = ccList.length ? `\nCc: ${ccList.join(", ")}` : "";
  if (!result.delivered) {
    console.log(
      `\n───── [send-order STUB] 미전송 ─────\nTo: ${recipient}${ccLine}\nSubject: ${subject}\n\n${text}\n───────────────────────────────────\n`
    );
  }

  return NextResponse.json({
    ok: true,
    delivered: result.delivered,
    provider: result.provider,
    testSend: !!testSend,
    to: recipient,
    cc: ccList.join(", "),
    subject,
    lines: resultLines,
    preview: text,
  });
}

export async function GET() {
  // 수신자 기본값(실제 이메일 주소)도 승인 계정에만 (감사 ⑤ 치명2 후속)
  const who = await requireTradingUser();
  if (!who.ok) return NextResponse.json({ error: who.error }, { status: who.status });
  return NextResponse.json({ defaultTo: DEFAULT_TO, defaultCc: DEFAULT_CC });
}
