/**
 * 매수 주문 이메일 본문 생성 (요구사항 4).
 *
 * 담당자가 증권사에 보내던 매수요청 메일 양식을 그대로 생성한다:
 * 인사말/서명 + 우측 상단 주문일 + [순번·구분·ISIN·종목명·USD·매수수량] 표 +
 * USD 송금액 합계 + 안내문. USD 기준이며 원화는 싣지 않는다(원화 입력·환산은
 * 화면에서만). 인사말·서명은 환경변수(ORDER_EMAIL_GREETING / ORDER_EMAIL_SIGNATURE)로
 * 바꾼다. 실제 전송은 src/app/api/send-order/route.ts 의 sendEmail() 어댑터가
 * 담당한다(현재 stub).
 */

import { fmtInt, fmtNum as fmt } from "@/lib/format";

/** 환경변수 미설정 시 기본 인사말 */
export const DEFAULT_GREETING = [
  "안녕하세요. 한화투자증권 상품운용팀입니다.",
  "금일 채권 매수 요청드립니다.",
  "감사합니다.",
].join("\n");

/** 환경변수 미설정 시 기본 서명 */
export const DEFAULT_SIGNATURE = "권혜진 드림";

/** 표 하단 안내문 */
const FOOTER_NOTE = "- 매수 결제시 종목별 USD 송금액을 넘지 않도록 요청드립니다.";

export interface OrderEmailLine {
  isin: string;
  isinVerified: boolean;
  /** 만기일 (YYYY-MM-DD) */
  maturityDate: string;
  /** USD 송금액 (달러 환전액) */
  usdAmount: number;
  /** 매수수량 (실제 주문수량, 정수 좌) */
  quantity: number;
}

export interface OrderEmailData {
  /** 주문일 (표 우측 상단) */
  orderDate: string;
  /** 인사말 (여러 줄 가능) */
  greeting: string;
  /** 서명 */
  signature: string;
  lines: OrderEmailLine[];
  /** 추가 메모 (선택) */
  note?: string;
}

/** "2035-01-01" → "BNTNF 01/01/35" */
function bondName(maturityDate: string): string {
  const [y, m, d] = maturityDate.split("-");
  return `BNTNF ${m}/${d}/${y.slice(2)}`;
}

export function buildOrderEmail(data: OrderEmailData): {
  subject: string;
  text: string;
  html: string;
} {
  const { lines } = data;
  const totalUsd = lines.reduce((s, l) => s + l.usdAmount, 0);

  const subject =
    lines.length === 1
      ? `[브라질국채 매수요청] ${bondName(lines[0].maturityDate)} ${fmtInt(
          lines[0].quantity
        )}좌 (${data.orderDate})`
      : `[브라질국채 매수요청] ${lines.length}개 종목 · USD ${fmt(
          totalUsd,
          2
        )} (${data.orderDate})`;

  // ---- 텍스트 본문 ----
  const textRows = lines.map(
    (l, i) =>
      `${String(i + 1).padStart(2)}  매수  ${l.isin.padEnd(14)}  ${bondName(
        l.maturityDate
      ).padEnd(16)}  ${`$ ${fmt(l.usdAmount, 2)}`.padStart(16)}  ${`${fmtInt(
        l.quantity
      )} 좌`.padStart(10)}`
  );

  const text = [
    data.greeting,
    "",
    data.signature,
    "",
    `주문일: ${data.orderDate}`,
    "",
    `순번  구분  ${"ISIN".padEnd(14)}  ${"종목명".padEnd(14)}  ${"USD 송금액".padStart(
      14
    )}  ${"매수수량".padStart(8)}`,
    ...textRows,
    "",
    `USD 송금액 합계: $ ${fmt(totalUsd, 2)}`,
    "",
    FOOTER_NOTE,
    ...(data.note ? ["", "[메모]", data.note] : []),
  ].join("\n");

  // ---- HTML 본문 ----
  const th =
    "padding:6px 10px;border:1px solid #9db1d6;background:#4472c4;color:#fff;font-size:12px;font-weight:bold;text-align:center;white-space:nowrap";
  const tdc =
    "padding:6px 10px;border:1px solid #9db1d6;font-size:12px;text-align:center;white-space:nowrap";
  const tdNum =
    "padding:6px 10px;border:1px solid #9db1d6;font-size:12px;text-align:right;white-space:nowrap;color:#c00000;font-weight:bold";

  const htmlRows = lines
    .map((l, i) => {
      const [y, m, d] = l.maturityDate.split("-");
      return `<tr>
        <td style="${tdc}">${i + 1}</td>
        <td style="${tdc}">매수</td>
        <td style="${tdc}">${l.isin}${l.isinVerified ? "" : " ⚠"}</td>
        <td style="${tdc}">BNTNF<br>${m}/${d}/${y.slice(2)}</td>
        <td style="${tdNum}">${fmt(l.usdAmount, 2)}</td>
        <td style="${tdNum}">${fmtInt(l.quantity)}</td>
      </tr>`;
    })
    .join("");

  const greetingHtml = data.greeting.replace(/\n/g, "<br>");

  const html = `<!doctype html><meta charset="utf-8">
<div style="font-family:'맑은 고딕','Malgun Gothic',Arial,sans-serif;font-size:14px;color:#171717">
  <p style="margin:0 0 16px">${greetingHtml}</p>
  <p style="margin:0 0 20px">${data.signature}</p>
  <p style="margin:0 0 4px;text-align:right">${data.orderDate}</p>
  <table style="border-collapse:collapse">
    <thead><tr>
      <th style="${th}">순번</th><th style="${th}">구분</th>
      <th style="${th}">ISIN</th><th style="${th}">종목명</th>
      <th style="${th}">USD</th><th style="${th}">매수수량</th>
    </tr></thead>
    <tbody>${htmlRows}</tbody>
  </table>
  <p style="margin:14px 0 0;font-weight:bold">USD 송금액: <span style="color:#c00000">${fmt(
    totalUsd,
    2
  )}</span></p>
  <p style="margin:14px 0 0;font-size:13px">${FOOTER_NOTE}</p>
  ${
    data.note
      ? `<p style="margin:12px 0 0"><b>메모</b><br>${data.note.replace(
          /\n/g,
          "<br>"
        )}</p>`
      : ""
  }
</div>`;

  return { subject, text, html };
}
