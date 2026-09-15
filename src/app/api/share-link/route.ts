import { NextResponse, type NextRequest } from "next/server";
import type { BondLayoutInput } from "@/lib/cashflow/bondLayout";
import type { SharePayload } from "@/lib/cashflow/shareCodec";
import {
  createSignedParam,
  createTokenParam,
  tokenStoreKind,
  type ShareMethod,
} from "@/lib/server/shareLink";
import { requireTradingUser } from "@/lib/server/appAuth";

export const runtime = "nodejs";

/**
 * 공유 링크 생성 (감사 ⑤ 중10).
 * POST { input: BondLayoutInput, client: boolean, method: "signed" | "token" }
 *  → { url, method, storeKind }
 * 서명·토큰 발급 모두 서버 비밀키/저장소가 필요해 브라우저에서 만들 수 없다.
 */

const STRING_FIELDS: (keyof BondLayoutInput)[] = [
  "calcBasis", "investorType", "distributionType", "name", "issueDate", "maturityDate",
  "couponRate", "couponFrequency", "recentCouponDate", "taxStatus", "creditRating",
  "tradeCurrency", "custodyCurrency", "purchaseFxRate", "maturityFxRate",
  "trustContractDate", "purchaseYield", "trustInvestmentAmount", "frontFeeRate",
  "backFeeRate", "incomeTaxRate", "cashInterestRate", "reserveRate",
];

function sanitizeInput(raw: unknown): BondLayoutInput | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const out: Record<string, string> = {};
  for (const k of STRING_FIELDS) {
    const v = r[k];
    if (v == null) { out[k] = ""; continue; }
    if (typeof v !== "string" || v.length > 64) return null;
    out[k] = v;
  }
  return out as unknown as BondLayoutInput;
}

export async function GET() {
  return NextResponse.json({
    signed: !!process.env.SHARE_LINK_SECRET || process.env.NODE_ENV !== "production",
    token: tokenStoreKind(),
  });
}

export async function POST(request: NextRequest) {
  // 링크 생성은 승인된 회사 계정만 — 외부인이 저장소를 채우지 못하게
  const who = await requireTradingUser();
  if (!who.ok) return NextResponse.json({ error: who.error }, { status: who.status });

  let body: { input?: unknown; client?: unknown; method?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "요청 본문이 JSON 이 아닙니다." }, { status: 400 });
  }
  const input = sanitizeInput(body.input);
  if (!input) return NextResponse.json({ error: "입력값 형식이 올바르지 않습니다." }, { status: 400 });
  const method: ShareMethod = body.method === "token" ? "token" : "signed";
  const client = body.client === true;

  const payload: SharePayload = {
    input,
    meta: { client, issued: client ? new Date().toISOString().slice(0, 10) : null },
  };

  const url = new URL(request.nextUrl.origin);
  if (method === "signed") {
    const p = createSignedParam(payload);
    if (!p) {
      return NextResponse.json(
        { error: "SHARE_LINK_SECRET 환경변수가 없어 서명 링크를 만들 수 없습니다." },
        { status: 503 }
      );
    }
    url.searchParams.set("p", p);
  } else {
    const t = await createTokenParam(payload);
    if (!t) {
      return NextResponse.json(
        { error: "링크 저장소(Upstash Redis)가 연결되지 않아 서버저장형 링크를 만들 수 없습니다." },
        { status: 503 }
      );
    }
    url.searchParams.set("t", t);
  }
  return NextResponse.json({ url: url.toString(), method, storeKind: tokenStoreKind() });
}
