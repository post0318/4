import { OrderConsole } from "@/components/OrderConsole";
import { resolveShareLink } from "@/lib/server/shareLink";

/**
 * 공유 링크(`?p=` 서명형 / `?t=` 서버저장형 / 옛 `?bond=`)는 서버에서 해석해
 * props 로 내려준다. 비밀키·저장소가 서버에만 있고, 브라우저에서 window.location
 * 을 읽어 첫 렌더가 서버 HTML 과 어긋나던 문제(감사 ⑤ 중6)도 함께 없어진다.
 */
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const share = await resolveShareLink(await searchParams);
  return <OrderConsole share={share} />;
}
