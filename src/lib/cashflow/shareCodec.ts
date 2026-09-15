import type {
  BondLayoutInput,
  CalcBasis,
  CouponFrequency,
  Currency,
  DistributionType,
  InvestorType,
  TaxStatus,
} from "@/lib/cashflow/bondLayout";

/**
 * 공유 링크 바이너리 코덱 (감사 ⑤ 중10, 방안 B의 "패킹" 부분).
 *
 * 예전 lz-string 링크는 23개 필드를 문자열로 이어 붙여 압축했다(112자). 여기서는
 * 값을 바이트로 직접 담는다 — 날짜 2바이트, 백분율 2바이트(×100), 환율 4바이트
 * (×10000), 금액 8바이트, 코드값 1바이트 — 약 50바이트. 서명(8바이트)은
 * 서버 모듈(`src/lib/server/shareLink.ts`)이 붙인다.
 *
 * 고객 모드 여부·발급일도 페이로드 안에 넣어 함께 서명되므로, 예전처럼
 * `?view=client`를 지워 인쇄 차단을 푸는 일이 불가능하다.
 *
 * 형식(v1, big-endian):
 *   u8  version=1
 *   u8  flags   bit0 client, bit1 hasName, bit2 hasRating
 *   u16 issued  (2000-01-01 기준 일수, 0xFFFF=없음)
 *   u16 ×4      issueDate, maturityDate, recentCouponDate, trustContractDate
 *   u8  ×7      couponFrequency, taxStatus, calcBasis, tradeCurrency,
 *               custodyCurrency, investorType, distributionType (0=빈값)
 *   i16 ×7      couponRate, purchaseYield, frontFeeRate, backFeeRate,
 *               incomeTaxRate, cashInterestRate, reserveRate (×100, -32768=빈값)
 *   i32 ×2      purchaseFxRate, maturityFxRate (×10000, INT32_MIN=빈값)
 *   f64         trustInvestmentAmount (NaN=빈값)
 *   [u8 len + utf8] creditRating (hasRating 일 때)
 *   [u8 len + utf8] name (hasName 일 때 — 기본 "NTN-F 10% 만기일"과 다를 때만)
 */

export interface ShareMeta {
  /** 고객 열람 모드(트레이딩 탭 숨김 + 인쇄·복사 차단) */
  client: boolean;
  /** 발급일 YYYY-MM-DD (워터마크용), 없으면 null */
  issued: string | null;
}

export interface SharePayload {
  input: BondLayoutInput;
  meta: ShareMeta;
}

const VERSION = 1;
const EPOCH_MS = Date.UTC(2000, 0, 1);
const NO_DATE = 0xffff;
const NO_I16 = -32768;
const NO_I32 = -2147483648;

// ---- 코드표 (bondLink.ts 와 동일한 값을 쓴다 — 옛 링크와 의미 일치) ----
const COUPON_FREQUENCY: CouponFrequency[] = ["3개월", "6개월", "12개월"];
const TAX_STATUS: TaxStatus[] = ["일반과세", "비과세"];
const CALC_BASIS: CalcBasis[] = [
  "미국 30/360",
  "ACT/ACT",
  "ACT/360",
  "ACT/365",
  "유럽 30/360",
  "Business/252",
];
const CURRENCY: Currency[] = ["KRW", "BRL"];
const INVESTOR_TYPE: InvestorType[] = ["개인", "일반법인", "금융법인"];
const DISTRIBUTION: DistributionType[] = ["반기", "월", "재투자"];

function toCode<T extends string>(list: readonly T[], v: string): number {
  const i = list.indexOf(v as T);
  return i < 0 ? 0 : i + 1;
}
function fromCode<T extends string>(list: readonly T[], c: number): T | undefined {
  return c >= 1 && c <= list.length ? list[c - 1] : undefined;
}

// ---- 날짜 ----
function dateToDays(iso: string): number {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return NO_DATE;
  const ms = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  const days = Math.round((ms - EPOCH_MS) / 86400000);
  return days >= 0 && days < NO_DATE ? days : NO_DATE;
}
function daysToDate(days: number): string {
  if (days === NO_DATE) return "";
  return new Date(EPOCH_MS + days * 86400000).toISOString().slice(0, 10);
}

// ---- 숫자 ----
function pctToI16(s: string): number {
  const v = Number(s);
  if (s === "" || !Number.isFinite(v)) return NO_I16;
  const r = Math.round(v * 100);
  return r > 32767 || r < -32767 ? NO_I16 : r;
}
function i16ToPct(v: number): string {
  return v === NO_I16 ? "" : (v / 100).toFixed(2);
}
function fxToI32(s: string): number {
  const v = Number(s);
  if (s === "" || !Number.isFinite(v)) return NO_I32;
  const r = Math.round(v * 10000);
  return r > 2147483647 || r <= NO_I32 ? NO_I32 : r;
}
function i32ToFx(v: number): string {
  if (v === NO_I32) return "";
  // 4자리까지 표현하되 뒤따르는 0은 지운다: 1346.24, 5.1566, 5.4
  return (v / 10000).toFixed(4).replace(/\.?0+$/, "");
}
function amountToF64(s: string): number {
  const v = Number(s);
  return s === "" || !Number.isFinite(v) ? NaN : v;
}
function f64ToAmount(v: number): string {
  return Number.isNaN(v) ? "" : String(Math.round(v));
}

/** 종목명 기본값 — 만기일만 있으면 링크에 이름을 안 담아도 복원된다 */
export function defaultBondName(maturityDate: string): string {
  return maturityDate ? `NTN-F 10% ${maturityDate}` : "";
}

const enc = new TextEncoder();
const dec = new TextDecoder();

function putStr(out: number[], s: string): void {
  const b = enc.encode(s).slice(0, 255);
  out.push(b.length, ...b);
}

/** 입력값 + 메타 → 바이트 (서명 전) */
export function packShare(payload: SharePayload): Uint8Array {
  const { input, meta } = payload;
  const hasName = !!input.name && input.name !== defaultBondName(input.maturityDate);
  const hasRating = !!input.creditRating;
  const flags = (meta.client ? 1 : 0) | (hasName ? 2 : 0) | (hasRating ? 4 : 0);

  const head = new ArrayBuffer(4 + 8 + 7 + 14 + 8 + 8);
  const dv = new DataView(head);
  let o = 0;
  dv.setUint8(o++, VERSION);
  dv.setUint8(o++, flags);
  dv.setUint16(o, meta.issued ? dateToDays(meta.issued) : NO_DATE); o += 2;
  for (const d of [input.issueDate, input.maturityDate, input.recentCouponDate, input.trustContractDate]) {
    dv.setUint16(o, dateToDays(d)); o += 2;
  }
  for (const c of [
    toCode(COUPON_FREQUENCY, input.couponFrequency),
    toCode(TAX_STATUS, input.taxStatus),
    toCode(CALC_BASIS, input.calcBasis),
    toCode(CURRENCY, input.tradeCurrency),
    toCode(CURRENCY, input.custodyCurrency),
    toCode(INVESTOR_TYPE, input.investorType),
    toCode(DISTRIBUTION, input.distributionType),
  ]) {
    dv.setUint8(o++, c);
  }
  for (const p of [
    input.couponRate, input.purchaseYield, input.frontFeeRate, input.backFeeRate,
    input.incomeTaxRate, input.cashInterestRate, input.reserveRate,
  ]) {
    dv.setInt16(o, pctToI16(p)); o += 2;
  }
  dv.setInt32(o, fxToI32(input.purchaseFxRate)); o += 4;
  dv.setInt32(o, fxToI32(input.maturityFxRate)); o += 4;
  dv.setFloat64(o, amountToF64(input.trustInvestmentAmount)); o += 8;

  const out: number[] = Array.from(new Uint8Array(head));
  if (hasRating) putStr(out, input.creditRating);
  if (hasName) putStr(out, input.name);
  return Uint8Array.from(out);
}

/** 바이트 → 입력값 + 메타. 형식이 맞지 않으면 null (서명 검증은 호출부 책임) */
export function unpackShare(bytes: Uint8Array): SharePayload | null {
  try {
    const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    let o = 0;
    if (dv.getUint8(o++) !== VERSION) return null;
    const flags = dv.getUint8(o++);
    const issuedDays = dv.getUint16(o); o += 2;
    const dates: string[] = [];
    for (let i = 0; i < 4; i++) { dates.push(daysToDate(dv.getUint16(o))); o += 2; }
    const codes: number[] = [];
    for (let i = 0; i < 7; i++) codes.push(dv.getUint8(o++));
    const pcts: string[] = [];
    for (let i = 0; i < 7; i++) { pcts.push(i16ToPct(dv.getInt16(o))); o += 2; }
    const purchaseFxRate = i32ToFx(dv.getInt32(o)); o += 4;
    const maturityFxRate = i32ToFx(dv.getInt32(o)); o += 4;
    const trustInvestmentAmount = f64ToAmount(dv.getFloat64(o)); o += 8;

    const readStr = (): string => {
      const len = dv.getUint8(o++);
      const s = dec.decode(bytes.subarray(o, o + len));
      o += len;
      return s;
    };
    const creditRating = flags & 4 ? readStr() : "";
    const [issueDate, maturityDate, recentCouponDate, trustContractDate] = dates;
    const name = flags & 2 ? readStr() : defaultBondName(maturityDate);
    if (o !== bytes.byteLength) return null;

    const input: BondLayoutInput = {
      name,
      issueDate,
      maturityDate,
      recentCouponDate,
      trustContractDate,
      couponFrequency: fromCode(COUPON_FREQUENCY, codes[0]) ?? "6개월",
      taxStatus: fromCode(TAX_STATUS, codes[1]) ?? "비과세",
      calcBasis: fromCode(CALC_BASIS, codes[2]) ?? "Business/252",
      tradeCurrency: fromCode(CURRENCY, codes[3]) ?? "BRL",
      custodyCurrency: fromCode(CURRENCY, codes[4]) ?? "KRW",
      investorType: fromCode(INVESTOR_TYPE, codes[5]) ?? "개인",
      distributionType: fromCode(DISTRIBUTION, codes[6]) ?? "반기",
      creditRating,
      couponRate: pcts[0],
      purchaseYield: pcts[1],
      frontFeeRate: pcts[2],
      backFeeRate: pcts[3],
      incomeTaxRate: pcts[4],
      cashInterestRate: pcts[5],
      reserveRate: pcts[6],
      purchaseFxRate,
      maturityFxRate,
      trustInvestmentAmount,
    };
    return {
      input,
      meta: { client: (flags & 1) === 1, issued: issuedDays === NO_DATE ? null : daysToDate(issuedDays) },
    };
  } catch {
    return null;
  }
}

// ---- base64url ----
export function toBase64Url(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  const b64 = typeof btoa === "function" ? btoa(bin) : Buffer.from(bin, "binary").toString("base64");
  return b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
export function fromBase64Url(s: string): Uint8Array | null {
  if (!/^[A-Za-z0-9_-]*$/.test(s)) return null;
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4);
  try {
    const bin = typeof atob === "function" ? atob(b64) : Buffer.from(b64, "base64").toString("binary");
    return Uint8Array.from(bin, (c) => c.charCodeAt(0));
  } catch {
    return null;
  }
}
