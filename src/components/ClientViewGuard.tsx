"use client";

import { useEffect } from "react";

/**
 * 승인 계정으로 로그인하지 않은 방문자 전원 + 고객 공유 링크(고객 모드) 열람자에게 건다
 * (오너 지시 2026-10-11 — 로그인은 본사 승인자만이라 로그인하면 제한이 풀린다).
 *  - 인쇄 차단: `@media print` 에서 본문을 숨기고 안내문만 (globals.css의
 *    `body.client-view` 규칙)
 *  - 우클릭·복사·잘라내기·드래그 차단 + 텍스트 선택 불가
 *  - 화면 전체 워터마크 오버레이 (캡처는 웹에서 못 막으므로 추적·억제용).
 *    발급일 + 열람자 IP(서버가 요청 헤더에서 읽어 내려준 값)
 * ※ 스크린샷·사진 촬영은 OS/외부 기기 동작이라 웹에서 원천 차단 불가.
 */
export function ClientViewGuard({
  issued,
  viewerIp,
}: {
  issued: string | null;
  viewerIp: string | null;
}) {
  useEffect(() => {
    document.body.classList.add("client-view");
    const block = (e: Event) => e.preventDefault();
    const events = ["contextmenu", "copy", "cut", "dragstart"] as const;
    events.forEach((ev) => document.addEventListener(ev, block));
    return () => {
      document.body.classList.remove("client-view");
      events.forEach((ev) => document.removeEventListener(ev, block));
    };
  }, []);

  // 한 줄에 다 넣으면 타일 폭을 넘어 잘리므로 IP 는 둘째 줄로
  const label = `사내 참고용 · 무단 복제·배포 금지${issued ? ` · ${issued}` : ""}`;
  const svg =
    `<svg xmlns='http://www.w3.org/2000/svg' width='360' height='220'>` +
    `<text x='14' y='${viewerIp ? 122 : 130}' transform='rotate(-27 180 110)' ` +
    `fill='rgba(120,122,132,0.16)' font-size='14' font-weight='600' ` +
    `font-family='system-ui,-apple-system,sans-serif'>${label}` +
    (viewerIp ? `<tspan x='14' dy='18'>IP ${viewerIp}</tspan>` : "") +
    `</text></svg>`;
  const uri = `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;

  return (
    <>
      <div
        aria-hidden="true"
        className="pointer-events-none fixed inset-0 z-[9998] select-none"
        style={{ backgroundImage: `url("${uri}")`, backgroundRepeat: "repeat" }}
      />
      <div className="client-print-notice" aria-hidden="true">
        인쇄할 수 없습니다 — 사내 참고용 자료입니다.
      </div>
    </>
  );
}
