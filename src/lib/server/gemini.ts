import "server-only";

/**
 * Gemini API(REST) 최소 클라이언트 — 글로벌 뉴스 제목 번역·해설 전용. SDK 없이 fetch 한 번.
 * 키는 위클리 앱(post0318/5)과 같은 GEMINI_API_KEY 를 쓴다(오너 결정 2026-10-11 —
 * 같은 프로젝트 크레딧을 나눠 씀). 모델은 GEMINI_MODEL 로 교체 가능.
 * 실패하면 예외 — 호출 쪽이 무료 번역으로 폴백한다.
 */

const DEFAULT_MODEL = "gemini-3.8-flash";
// 기본 모델이 404(이름 변경·폐기)일 때 순서대로 시도 — 위클리 앱과 같은 체인
const FALLBACK_MODELS = ["gemini-3.7-flash", "gemini-flash-latest"];

export function isGeminiConfigured(): boolean {
  return Boolean(process.env.GEMINI_API_KEY);
}

interface RawResponse {
  candidates?: {
    content?: { parts?: { text?: string; thought?: boolean }[] };
    finishReason?: string;
  }[];
  error?: { message?: string; status?: string };
}

/** JSON 응답을 강제해 텍스트로 돌려준다. 파싱은 호출 쪽에서. */
export async function geminiJson(opts: {
  system: string;
  user: string;
  timeoutMs: number;
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
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
      {
        method: "POST",
        headers: { "content-type": "application/json", "x-goog-api-key": key },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: opts.system }] },
          contents: [{ role: "user", parts: [{ text: opts.user }] }],
          generationConfig: {
            temperature: 0.2,
            maxOutputTokens: 8000,
            responseMimeType: "application/json",
          },
        }),
        signal: AbortSignal.timeout(left),
      }
    );
    const body = (await res.json().catch(() => ({}))) as RawResponse;
    if (res.status === 404 || body.error?.status === "NOT_FOUND") {
      lastErr = `${model}: ${body.error?.message ?? "not found"}`;
      continue;
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
