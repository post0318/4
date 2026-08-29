/**
 * 매수 주문 이메일 본문 생성 (요구사항 4).
 *
 * 체크된 종목만 주문 대상이다(여러 종목 가능). 각 종목은 자체 원화투자금액과
 * 산출 수량을 가진다. 실제 전송은 src/app/api/send-order/route.ts 의 sendEmail()
 * 어댑터가 담당한다(현재 stub).
 */

import { fmtInt, fmtNum as fmt } from "@/lib/format";

export interface BondOrderLine {
  isin: string;
  isinVerified: boolean;
  nameKo: string;
  namePt: string;
  maturityDate: string;
  couponRatePct: number;
  /** 매수수익률 (연, %) */
  buyYieldPct: number;
  /** 원화투자금액 (KRW) */
  krwAmount: number;
  /** 달러 환전액 (USD) */
  usdAmount: number;
  /** 헤알 환산액 (BRL) */
  brlAmount: number;
  /** 매수단가 (PU, per título, BRL) */
  pu: number;
  /** 매수수량 (정수, 좌) */
  quantity: number;
  /** 실매수금액 (BRL) */
  brlCost: number;
  /** 실매수금액 (KRW 환산) */
  krwCost: number;
  /** 잔여현금 (KRW 환산) */
  krwLeftover: number;
}

export interface OrderEmailData {
  orderDate: string;
  settlementDate: string;
  fx: {
    usdKrw: number;
    usdBrl: number;
    krwBrl: number;
    asOf: string | null;
  };
  lines: BondOrderLine[];
  note?: string;
}

export function buildOrderEmail(data: OrderEmailData): {
  subject: string;
  text: string;
  html: string;
} {
  const { fx, lines } = data;
  const totalKrw = lines.reduce((s, l) => s + l.krwAmount, 0);
  const totalKrwCost = lines.reduce((s, l) => s + l.krwCost, 0);

  const subject =
    lines.length === 1
      ? `[브라질국채 매수주문] ${lines[0].nameKo} ${fmtInt(
          lines[0].quantity
        )}좌 (주문일 ${data.orderDate})`
      : `[브라질국채 매수주문] ${lines.length}개 종목 · 총 ₩${fmtInt(
          totalKrw
        )} (주문일 ${data.orderDate})`;

  const header = [
    `주문일        : ${data.orderDate}`,
    `결제일 (D+0)  : ${data.settlementDate}`,
    `환율(중간)    : 원/달러 ${fmt(fx.usdKrw, 2)} · 달러/헤알 ${fmt(
      fx.usdBrl,
      4
    )} · 원/헤알 ${fmt(fx.krwBrl, 2)}`,
    `환율 기준시각 : ${fx.asOf ?? "-"}`,
  ].join("\n");

  const blocks = lines
    .map((l, i) => {
      const rows: [string, string][] = [
        ["종목명", `${l.nameKo} / ${l.namePt}`],
        ["ISIN", `${l.isin}${l.isinVerified ? "" : " (확인 필요)"}`],
        ["만기일", l.maturityDate],
        ["표면이율", `연 ${fmt(l.couponRatePct, 2)}%`],
        ["매수수익률", `연 ${fmt(l.buyYieldPct, 4)}%`],
        ["매수단가 (PU)", `R$ ${fmt(l.pu, 4)}`],
        ["원화투자금액", `₩ ${fmtInt(l.krwAmount)}`],
        ["달러 환전액", `$ ${fmt(l.usdAmount, 2)}`],
        ["헤알 환산액", `R$ ${fmt(l.brlAmount, 2)}`],
        ["매수수량", `${fmtInt(l.quantity)} 좌`],
        ["실매수금액 (BRL)", `R$ ${fmt(l.brlCost, 2)}`],
        ["실매수금액 (KRW 환산)", `₩ ${fmtInt(l.krwCost)}`],
        ["잔여현금 (KRW 환산)", `₩ ${fmtInt(l.krwLeftover)}`],
      ];
      return (
        `[${i + 1}] ${l.nameKo}\n` +
        rows.map(([k, v]) => `    ${k.padEnd(20, " ")}: ${v}`).join("\n")
      );
    })
    .join("\n\n");

  const totals =
    lines.length > 1
      ? `\n\n합계\n    원화투자금액 총액      : ₩ ${fmtInt(
          totalKrw
        )}\n    실매수금액(KRW) 총액   : ₩ ${fmtInt(totalKrwCost)}`
      : "";

  const text =
    header +
    "\n\n" +
    blocks +
    totals +
    (data.note ? `\n\n[메모]\n${data.note}` : "") +
    "\n\n※ 환율은 중간환율(스프레드 미반영). 매수수량 = 헤알 환산액 ÷ PU 정수 절사(1좌 = 액면 R$1,000).";

  const thStyle =
    "padding:6px 8px;border:1px solid #d4d4d8;background:#f4f4f5;text-align:left;font-size:12px;white-space:nowrap";
  const tdStyle = "padding:6px 8px;border:1px solid #d4d4d8;font-size:12px;white-space:nowrap";

  const html = `<!doctype html><meta charset="utf-8">
<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#171717">
  <h2 style="margin:0 0 8px">브라질국채 매수주문</h2>
  <p style="margin:0 0 4px;color:#6b7280;font-size:12px">주문일 ${data.orderDate} · 결제일 ${data.settlementDate} (D+0)</p>
  <p style="margin:0 0 12px;color:#6b7280;font-size:12px">환율(중간) 원/달러 ${fmt(
    fx.usdKrw,
    2
  )} · 달러/헤알 ${fmt(fx.usdBrl, 4)} · 원/헤알 ${fmt(fx.krwBrl, 2)} · 기준 ${
    fx.asOf ?? "-"
  }</p>
  <table style="border-collapse:collapse">
    <thead><tr>
      <th style="${thStyle}">종목명</th><th style="${thStyle}">ISIN</th>
      <th style="${thStyle}">만기일</th><th style="${thStyle}">매수수익률</th>
      <th style="${thStyle}">PU(R$)</th><th style="${thStyle}">원화투자금액</th>
      <th style="${thStyle}">달러($)</th><th style="${thStyle}">매수수량</th>
      <th style="${thStyle}">실매수금액(₩)</th><th style="${thStyle}">잔여(₩)</th>
    </tr></thead>
    <tbody>
      ${lines
        .map(
          (l) => `<tr>
        <td style="${tdStyle}">${l.nameKo}${
            l.isinVerified ? "" : " ⚠"
          }</td><td style="${tdStyle}">${l.isin}</td>
        <td style="${tdStyle}">${l.maturityDate}</td><td style="${tdStyle}">연 ${fmt(
            l.buyYieldPct,
            2
          )}%</td>
        <td style="${tdStyle}">${fmt(l.pu, 4)}</td><td style="${tdStyle}">₩ ${fmtInt(
            l.krwAmount
          )}</td>
        <td style="${tdStyle}">$ ${fmt(l.usdAmount, 2)}</td><td style="${tdStyle}"><b>${fmtInt(
            l.quantity
          )} 좌</b></td>
        <td style="${tdStyle}">₩ ${fmtInt(l.krwCost)}</td><td style="${tdStyle}">₩ ${fmtInt(
            l.krwLeftover
          )}</td>
      </tr>`
        )
        .join("")}
    </tbody>
    ${
      lines.length > 1
        ? `<tfoot><tr>
      <td style="${tdStyle}" colspan="5"><b>합계</b></td>
      <td style="${tdStyle}"><b>₩ ${fmtInt(totalKrw)}</b></td>
      <td style="${tdStyle}"></td><td style="${tdStyle}"></td>
      <td style="${tdStyle}"><b>₩ ${fmtInt(totalKrwCost)}</b></td><td style="${tdStyle}"></td>
    </tr></tfoot>`
        : ""
    }
  </table>
  ${
    data.note
      ? `<p style="margin:12px 0 0"><b>메모</b><br>${data.note.replace(
          /\n/g,
          "<br>"
        )}</p>`
      : ""
  }
  <p style="margin:12px 0 0;color:#6b7280;font-size:12px">※ 환율은 중간환율(스프레드 미반영). 매수수량 = 헤알 환산액 ÷ PU 정수 절사(1좌 = 액면 R$1,000).</p>
</div>`;

  return { subject, text, html };
}
