"use client";

import { useEffect } from "react";

/**
 * 고객 열람 링크(`?view=client`)로 진입했을 때만 동작한다. 원본(사내) 화면엔
 * 영향 없음.
 *  - 인쇄 차단: `@media print` 에서 본문을 숨기고 안내문만 (globals.css의
 *    `body.client-view` 규칙)
 *  - 우클릭·복사·잘라내기·드래그 차단 + 텍스트 선택 불가
 *  - 화면 전체 워터마크 오버레이 (캡처는 웹에서 못 막으므로 추적·억제용)
 * ※ 스크린샷·사진 촬영은 OS/외부 기기 동작이라 웹에서 원천 차단 불가.
 */
export function ClientViewGuard({ issued }: { issued: string | null }) {
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

  const label = `사내 참고용 · 무단 복제·배포 금지${issued ? ` · ${issued}` : ""}`;
  const svg =
    `<svg xmlns='http://www.w3.org/2000/svg' width='360' height='220'>` +
    `<text x='14' y='130' transform='rotate(-27 180 110)' ` +
    `fill='rgba(120,122,132,0.16)' font-size='14' font-weight='600' ` +
    `font-family='system-ui,-apple-system,sans-serif'>${label}</text></svg>`;
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
