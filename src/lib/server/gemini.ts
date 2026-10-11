import "server-only";

/**
 * Gemini API(REST) 최소 클라이언트 — 글로벌 뉴스 클릭 요약 전용. SDK 없이 fetch 한 번.
 *
 * **비용 0 원칙**(오너 지시 2026-10-11): GEMINI_API_KEY 는 결제(Billing)를 연결하지
 * 않은 Google 프로젝트의 무료 키여야 한다. 그런 키는 한도를 넘으면 429 로 거절될 뿐
 * 청구되지 않는다. 위클리 앱(post0318/5)의 키는 크레딧 결제가 붙어 있어 쓰지 않는다.
 * 모델은 GEMINI_MODEL 로 교체 가능.
 */

// 무료 등급에서 최신 Flash(3.8·flash-latest)는 100초+ 지연 — 3.5 Flash 는 ~9초(2026-10-11 실측)
const DEFAULT_MODEL = "gemini-3.5-flash";
// 기본 모델이 404(이름 변경·폐기)일 때 순서대로 시도 — 위클리 앱과 같은 체인
const FALLBACK_MODELS = ["gemini-3.5-flash-lite", "gemini-flash-lite-latest"];

export function isGeminiConfigured(): boolean {
  return Boolean(process.env.GEMINI_API_KEY);
}

/** 무료 한도 초과(429) — 화면에 "지금은 요약 불가" 로 보여준다 */
export class GeminiQuotaError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GeminiQuotaError";
  }
}

interface RawResponse {
  candidates?: {
    content?: { parts?: { text?: string; thought?: boolean }[] };
    finishReason?: string;
  }[];
  error?: { message?: string; status?: string };
}

export async function geminiText(opts: {
  system: string;
  user: string;
  timeoutMs: number;
  /** 모델이 user 안의 URL 을 직접 읽게 한다(url_context 도구) */
  readUrls?: boolean;
}): Promise<string> {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error("GEMINI_API_KEY 미설정");
  const primary = process.env.GEMINI_MODEL?.trim() || DEFAULT_MODEL;
  const chain = primary === DEFAULT_MODEL ? [primary, ...FALLBACK_MODELS] : [primary];
  const deadline = Date.now() + opts.timeoutMs;

  let lastErr = "";
  for (const model of chain) {
    const left = deadline - Date.now();
    if (left <= 0) break;
    const payload: Record<string, unknown> = {
      systemInstruction: { parts: [{ text: opts.system }] },
      contents: [{ role: "user", parts: [{ text: opts.user }] }],
      generationConfig: { temperature: 0.2, maxOutputTokens: 8000 },
    };
    if (opts.readUrls) payload.tools = [{ url_context: {} }];
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
      {
        method: "POST",
        headers: { "content-type": "application/json", "x-goog-api-key": key },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(left),
      }
    );
    const body = (await res.json().catch(() => ({}))) as RawResponse;
    if (res.status === 404 || body.error?.status === "NOT_FOUND") {
      lastErr = `${model}: ${body.error?.message ?? "not found"}`;
      continue;
    }
    if (res.status === 429) {
      throw new GeminiQuotaError(`Gemini ${model} 429: ${body.error?.message ?? "quota"}`);
    }
    if (!res.ok) {
      throw new Error(`Gemini ${model} ${res.status}: ${body.error?.message ?? "unknown"}`);
    }
    const cand = body.candidates?.[0];
    const text = (cand?.content?.parts ?? [])
      .filter((p) => !p.thought && typeof p.text === "string")
      .map((p) => p.text as string)
      .join("");
    if (!text.trim()) {
      throw new Error(`Gemini ${model}: 빈 응답 (finishReason=${cand?.finishReason ?? "?"})`);
    }
    return text;
  }
  throw new Error(`Gemini 호출 실패 — ${lastErr || "시간 초과"}`);
}
