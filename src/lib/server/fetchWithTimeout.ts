/**
 * 외부 API 호출 공통 타임아웃 (감사 ⑤ 중9).
 * 상대 서버가 응답하지 않으면 서버 함수 실행시간을 다 먹으므로 기본 6초에
 * 중단한다. `init.signal`이 이미 있으면 그대로 두고, 나머지 옵션(next.revalidate,
 * headers 등)은 그대로 전달한다. 타임아웃·네트워크 오류는 예외로 던지므로
 * 호출부는 try/catch 안에서 쓰거나 `fetchOrNull`을 쓴다.
 */
export const DEFAULT_FETCH_TIMEOUT_MS = 6000;

export function fetchWithTimeout(
  url: string,
  init: RequestInit = {},
  timeoutMs: number = DEFAULT_FETCH_TIMEOUT_MS
): Promise<Response> {
  return fetch(url, {
    ...init,
    signal: init.signal ?? AbortSignal.timeout(timeoutMs),
  });
}

/** 타임아웃·네트워크 오류·non-2xx 를 모두 null 로 돌려주는 편의 함수. */
export async function fetchOrNull(
  url: string,
  init: RequestInit = {},
  timeoutMs: number = DEFAULT_FETCH_TIMEOUT_MS
): Promise<Response | null> {
  try {
    const res = await fetchWithTimeout(url, init, timeoutMs);
    return res.ok ? res : null;
  } catch {
    return null;
  }
}
