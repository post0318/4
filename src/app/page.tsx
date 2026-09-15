import { OrderConsole } from "@/components/OrderConsole";
import { allowedEmailDomains } from "@/lib/server/appAuth";
import { resolveShareLink } from "@/lib/server/shareLink";

/**
 * 공유 링크(`?p=` 서명형 / `?t=` 서버저장형 / 옛 `?bond=`)는 서버에서 해석해
 * props 로 내려준다. 비밀키·저장소가 서버에만 있고, 브라우저에서 window.location
 * 을 읽어 첫 렌더가 서버 HTML 과 어긋나던 문제(감사 ⑤ 중6)도 함께 없어진다.
 * `?signup=1` 은 Clerk 로그인 팝업의 "가입" 링크가 오는 곳 — 트레이딩 탭의
 * 가입 신청 폼(회사 이메일 검사)을 바로 연다.
 */
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const share = await resolveShareLink(sp);
  return (
    <OrderConsole
      share={share}
      allowedDomains={allowedEmailDomains()}
      openSignup={sp.signup === "1"}
    />
  );
}
