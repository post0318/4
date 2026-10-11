import "server-only";

import { Redis } from "@upstash/redis";

/**
 * 뉴스 보관함 — 30분마다 받는 최신 목록을 지난 기사와 합쳐 **최근 7일·최대 30건**을
 * 최신순으로 유지한다(오너 지시 2026-10-11 — 글로벌 핵심지표(post0318/5) 시장 뉴스처럼
 * 5건씩 페이지로 넘겨 보되 기사는 1주일치까지만).
 *
 * 같은 링크는 새로 받은 쪽으로 덮는다(번역·서명 갱신). 저장소: Redis `news:archive:<name>`
 * (8일 만료), 없으면(로컬) 프로세스 메모리.
 */

const KEEP_DAYS = 7;
export const ARCHIVE_MAX = 30;
const TTL_SEC = 8 * 24 * 3600;

const memory = new Map<string, unknown[]>();

function redis(): Redis | null {
  const url = process.env.UPSTASH_REDIS_REST_URL ?? process.env.KV_REST_API_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN ?? process.env.KV_REST_API_TOKEN;
  return url && token ? new Redis({ url, token }) : null;
}

export async function mergeNewsArchive<T extends { link: string; publishedAt: string }>(
  name: string,
  fresh: T[]
): Promise<T[]> {
  const key = `news:archive:${name}`;
  const store = redis();
  let old: T[] = (memory.get(key) as T[] | undefined) ?? [];
  if (store) {
    try {
      old = (await store.get<T[]>(key)) ?? old;
    } catch {
      // 저장소 장애 — 메모리 것으로
    }
  }

  const byLink = new Map<string, T>();
  for (const it of old) byLink.set(it.link, it);
  for (const it of fresh) byLink.set(it.link, it);

  const cutoff = Date.now() - KEEP_DAYS * 86_400_000;
  const merged = [...byLink.values()]
    .filter((it) => new Date(it.publishedAt).getTime() >= cutoff)
    .sort((a, b) => b.publishedAt.localeCompare(a.publishedAt))
    .slice(0, ARCHIVE_MAX);

  memory.set(key, merged);
  if (store) await store.set(key, merged, { ex: TTL_SEC }).catch(() => {});
  return merged;
}
