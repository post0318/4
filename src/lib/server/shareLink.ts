import "server-only";
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { Redis } from "@upstash/redis";
import { decompressFromEncodedURIComponent } from "lz-string";
import type { BondLayoutInput } from "@/lib/cashflow/bondLayout";
import { unpackLegacyBondText } from "@/lib/cashflow/bondLink";
import {
  fromBase64Url,
  packShare,
  toBase64Url,
  unpackShare,
  type ShareMeta,
  type SharePayload,
} from "@/lib/cashflow/shareCodec";

/**
 * 공유 링크 서버 로직 (감사 ⑤ 중10). 두 방식을 모두 지원한다.
 *
 *  - signed  `?p=<payload+서명>`  — 방안 B. 입력값을 바이너리로 담고 서버 비밀키
 *    (SHARE_LINK_SECRET) HMAC-SHA256 앞 8바이트(64비트)로 서명. 한 글자라도
 *    바꾸면 거부. 저장소 불필요, 회수 불가. 약 80자.
 *  - token   `?t=<10자 토큰>`     — 방안 A. 입력값을 저장소(Upstash Redis)에 넣고
 *    무작위 토큰만 링크에. 값이 주소에 없어 열람·변조 불가, TTL·회수 가능. 약 12자.
 *    저장소 미연결 시(로컬 개발) `.data/share-links.json` 파일로 대신한다.
 *  - legacy  `?bond=<lz-string>&view=client&iss=`  — 옛 링크 호환(서명 없음).
 */

export type ShareMethod = "signed" | "token";

export type ShareResolution =
  | { status: "ok"; method: ShareMethod | "legacy"; input: Partial<BondLayoutInput>; meta: ShareMeta }
  | { status: "invalid" | "expired" | "unavailable"; method: ShareMethod | "legacy" };

// ---------------------------------------------------------------- 서명(B)

const SIG_BYTES = 8;
const DEV_SECRET = "dev-only-share-link-secret";
let warned = false;

function secret(): string | null {
  const s = process.env.SHARE_LINK_SECRET;
  if (s && s.length >= 16) return s;
  if (process.env.NODE_ENV !== "production") {
    if (!warned) {
      warned = true;
      console.warn("[share-link] SHARE_LINK_SECRET 미설정 — 개발용 고정 키를 씁니다.");
    }
    return DEV_SECRET;
  }
  return null;
}

function sign(payload: Uint8Array, key: string): Uint8Array {
  return new Uint8Array(createHmac("sha256", key).update(payload).digest().subarray(0, SIG_BYTES));
}

/** 서명 링크 파라미터(p) 생성. 비밀키가 없으면 null (운영에서 미설정). */
export function createSignedParam(payload: SharePayload): string | null {
  const key = secret();
  if (!key) return null;
  const body = packShare(payload);
  const out = new Uint8Array(body.length + SIG_BYTES);
  out.set(body, 0);
  out.set(sign(body, key), body.length);
  return toBase64Url(out);
}

function resolveSigned(p: string): ShareResolution {
  const key = secret();
  if (!key) return { status: "unavailable", method: "signed" };
  const bytes = fromBase64Url(p);
  if (!bytes || bytes.length <= SIG_BYTES) return { status: "invalid", method: "signed" };
  const body = bytes.subarray(0, bytes.length - SIG_BYTES);
  const sig = bytes.subarray(bytes.length - SIG_BYTES);
  if (!timingSafeEqual(sig, sign(body, key))) return { status: "invalid", method: "signed" };
  const payload = unpackShare(body);
  if (!payload) return { status: "invalid", method: "signed" };
  return { status: "ok", method: "signed", input: payload.input, meta: payload.meta };
}

// ---------------------------------------------------------------- 토큰(A)

interface ShareRecord {
  v: 1;
  payload: SharePayload;
  createdAt: string;
  expiresAt: string;
}

interface ShareStore {
  kind: "upstash" | "file";
  get(token: string): Promise<ShareRecord | null>;
  put(token: string, rec: ShareRecord, ttlSec: number): Promise<void>;
}

const TOKEN_LEN = 10;
const TOKEN_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789"; // 헷갈리는 0/O/1/l/I 제외
const TTL_DAYS = Number(process.env.SHARE_LINK_TTL_DAYS) > 0 ? Number(process.env.SHARE_LINK_TTL_DAYS) : 180;
const KEY_PREFIX = "share:";

function newToken(): string {
  const bytes = randomBytes(TOKEN_LEN);
  let s = "";
  for (const b of bytes) s += TOKEN_ALPHABET[b % TOKEN_ALPHABET.length];
  return s;
}

function upstashStore(): ShareStore | null {
  const url = process.env.UPSTASH_REDIS_REST_URL ?? process.env.KV_REST_API_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN ?? process.env.KV_REST_API_TOKEN;
  if (!url || !token) return null;
  const redis = new Redis({ url, token });
  return {
    kind: "upstash",
    async get(t) {
      return (await redis.get<ShareRecord>(KEY_PREFIX + t)) ?? null;
    },
    async put(t, rec, ttlSec) {
      await redis.set(KEY_PREFIX + t, rec, { ex: ttlSec, nx: true });
    },
  };
}

/** 로컬 개발용 파일 저장소 — 운영(Vercel)에서는 쓰지 않는다(서버리스 파일시스템은 휘발). */
function fileStore(): ShareStore | null {
  if (process.env.NODE_ENV === "production" || process.env.VERCEL) return null;
  const file = path.join(process.cwd(), ".data", "share-links.json");
  const read = async (): Promise<Record<string, ShareRecord>> => {
    try {
      return JSON.parse(await fs.readFile(file, "utf8")) as Record<string, ShareRecord>;
    } catch {
      return {};
    }
  };
  return {
    kind: "file",
    async get(t) {
      const all = await read();
      const rec = all[t];
      return rec ?? null;
    },
    async put(t, rec) {
      const all = await read();
      all[t] = rec;
      await fs.mkdir(path.dirname(file), { recursive: true });
      await fs.writeFile(file, JSON.stringify(all, null, 2), "utf8");
    },
  };
}

function store(): ShareStore | null {
  return upstashStore() ?? fileStore();
}

/** 토큰 저장소 종류 — UI 에서 "서버저장형" 선택 가능 여부 표시용 */
export function tokenStoreKind(): "upstash" | "file" | null {
  return store()?.kind ?? null;
}

/** 토큰 링크 파라미터(t) 생성. 저장소가 없으면 null. */
export async function createTokenParam(payload: SharePayload): Promise<string | null> {
  const s = store();
  if (!s) return null;
  const now = Date.now();
  const ttlSec = TTL_DAYS * 86400;
  const rec: ShareRecord = {
    v: 1,
    payload,
    createdAt: new Date(now).toISOString(),
    expiresAt: new Date(now + ttlSec * 1000).toISOString(),
  };
  for (let i = 0; i < 3; i++) {
    const t = newToken();
    if (await s.get(t)) continue; // 충돌(사실상 없음) 시 재시도
    await s.put(t, rec, ttlSec);
    return t;
  }
  return null;
}

async function resolveToken(t: string): Promise<ShareResolution> {
  if (!/^[A-Za-z0-9]{10}$/.test(t)) return { status: "invalid", method: "token" };
  const s = store();
  if (!s) return { status: "unavailable", method: "token" };
  const rec = await s.get(t);
  if (!rec || rec.v !== 1) return { status: "invalid", method: "token" };
  if (new Date(rec.expiresAt).getTime() < Date.now()) return { status: "expired", method: "token" };
  return { status: "ok", method: "token", input: rec.payload.input, meta: rec.payload.meta };
}

// ---------------------------------------------------------------- 옛 링크

function resolveLegacy(bond: string, view: string | undefined, iss: string | undefined): ShareResolution {
  try {
    const text = decompressFromEncodedURIComponent(bond);
    const input = text ? unpackLegacyBondText(text) : null;
    if (!input) return { status: "invalid", method: "legacy" };
    return {
      status: "ok",
      method: "legacy",
      input,
      meta: {
        client: view === "client",
        issued: iss && /^\d{4}-\d{2}-\d{2}$/.test(iss) ? iss : null,
      },
    };
  } catch {
    return { status: "invalid", method: "legacy" };
  }
}

// ---------------------------------------------------------------- 진입점

type SearchParams = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

/** 페이지 진입 시 쿼리에서 공유 링크를 해석한다. 링크가 아니면 null. */
export async function resolveShareLink(sp: SearchParams): Promise<ShareResolution | null> {
  const p = one(sp.p);
  if (p) return resolveSigned(p);
  const t = one(sp.t);
  if (t) return resolveToken(t);
  const bond = one(sp.bond);
  if (bond) return resolveLegacy(bond, one(sp.view), one(sp.iss));
  return null;
}
