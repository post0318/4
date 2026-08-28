/**
 * 매수 주문 이메일 본문 생성 (요구사항 4).
 *
 * 실제 전송은 src/app/api/send-order/route.ts 의 sendEmail() 어댑터가 담당한다
 * (현재 stub). 여기서는 전송 수단과 무관하게 제목/텍스트/HTML 본문만 만든다.
 */

export interface OrderPayload {
  /** 주문일 (YYYY-MM-DD) */
  orderDate: string;
  /** 결제일 (YYYY-MM-DD, D+0 브라질 영업일) */
  settlementDate: string;
  /** 종목 */
  bond: {
    isin: string;
    isinVerified: boolean;
    nameKo: string;
    namePt: string;
    maturityDate: string;
    couponRatePct: number;
    /** 매수수익률 (연, %) */
    buyYieldPct: number;
  };
  /** 환율 (중간환율) */
  fx: {
    usdKrw: number;
    usdBrl: number;
    krwBrl: number;
    asOf: string | null;
  };
  /** 금액·수량 */
  amounts: {
    krwAmount: number;
    usdAmount: number;
    brlAmount: number;
    pu: number;
    quantity: number;
    brlCost: number;
    usdCost: number;
    krwCost: number;
    brlLeftover: number;
    krwLeftover: number;
  };
  /** 메모 (선택) */
  note?: string;
}

function fmt(n: number, digits = 2): string {
  return n.toLocaleString("ko-KR", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

function fmtInt(n: number): string {
  return Math.round(n).toLocaleString("ko-KR");
}

export function buildOrderEmail(order: OrderPayload): {
  subject: string;
  text: string;
  html: string;
} {
  const { bond, fx, amounts } = order;

  const subject = `[브라질국채 매수주문] ${bond.nameKo} ${fmtInt(
    amounts.quantity
  )}좌 (주문일 ${order.orderDate})`;

  const rows: [string, string][] = [
    ["주문일", order.orderDate],
    ["결제일 (D+0)", order.settlementDate],
    ["종목명", `${bond.nameKo} / ${bond.namePt}`],
    ["ISIN", `${bond.isin}${bond.isinVerified ? "" : " (확인 필요)"}`],
    ["만기일", bond.maturityDate],
    ["표면이율", `연 ${fmt(bond.couponRatePct, 2)}%`],
    ["매수수익률", `연 ${fmt(bond.buyYieldPct, 4)}%`],
    ["매수단가 (PU)", `R$ ${fmt(amounts.pu, 4)}`],
    ["―――――――――", "―――――――――"],
    ["원/달러 (중간환율)", fmt(fx.usdKrw, 2)],
    ["달러/헤알 (중간환율)", fmt(fx.usdBrl, 4)],
    ["원/헤알 (파생)", fmt(fx.krwBrl, 2)],
    ["환율 기준시각", fx.asOf ?? "-"],
    ["―――――――――", "―――――――――"],
    ["원화투자금액", `₩ ${fmtInt(amounts.krwAmount)}`],
    ["달러 환전액", `US$ ${fmt(amounts.usdAmount, 2)}`],
    ["헤알 환산액", `R$ ${fmt(amounts.brlAmount, 2)}`],
    ["매수수량", `${fmtInt(amounts.quantity)} 좌`],
    ["실매수금액 (BRL)", `R$ ${fmt(amounts.brlCost, 2)}`],
    ["실매수금액 (USD 환산)", `US$ ${fmt(amounts.usdCost, 2)}`],
    ["실매수금액 (KRW 환산)", `₩ ${fmtInt(amounts.krwCost)}`],
    ["잔여현금 (BRL)", `R$ ${fmt(amounts.brlLeftover, 2)}`],
    ["잔여현금 (KRW 환산)", `₩ ${fmtInt(amounts.krwLeftover)}`],
  ];

  const text =
    rows.map(([k, v]) => `${k.padEnd(22, " ")}: ${v}`).join("\n") +
    (order.note ? `\n\n[메모]\n${order.note}` : "") +
    "\n\n※ 환율은 중간환율(스프레드 미반영) 기준입니다. 매수수량은 헤알 환산액 ÷ PU 의 정수 절사(1좌 = 액면 R$1,000)입니다.";

  const html = `<!doctype html><meta charset="utf-8">
<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#171717;max-width:640px">
  <h2 style="margin:0 0 12px">브라질국채 매수주문</h2>
  <table style="border-collapse:collapse;width:100%">
    ${rows
      .map(
        ([k, v]) =>
          `<tr><td style="padding:4px 12px 4px 0;color:#6b7280;white-space:nowrap;vertical-align:top">${k}</td><td style="padding:4px 0;font-weight:600">${v}</td></tr>`
      )
      .join("")}
  </table>
  ${
    order.note
      ? `<p style="margin:16px 0 0"><strong>메모</strong><br>${order.note.replace(
          /\n/g,
          "<br>"
        )}</p>`
      : ""
  }
  <p style="margin:16px 0 0;color:#6b7280;font-size:12px">※ 환율은 중간환율(스프레드 미반영) 기준. 매수수량은 헤알 환산액 ÷ PU 의 정수 절사(1좌 = 액면 R$1,000).</p>
</div>`;

  return { subject, text, html };
}
