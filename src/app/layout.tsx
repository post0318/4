import type { Metadata } from "next";
import { ClerkProvider } from "@clerk/nextjs";
import { koKR } from "@clerk/localizations";
import { AppAuthProvider } from "@/components/auth/AppAuth";
import "./globals.css";

export const metadata: Metadata = {
  title: "브라질세상",
  description:
    "브라질 환율·기준금리·뉴스·일정과 NTN-F 매수 주문 준비를 한 화면에서 다루는 도구",
  robots: {
    index: false,
    follow: false,
  },
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  // Clerk 키가 없으면(로컬 초기 상태) 인증 없이 렌더 — 트레이딩·링크 생성만 잠긴다.
  const clerkEnabled = !!process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY;

  const body = (
    <html lang="ko" className="h-full antialiased">
      <head>
        <link rel="preconnect" href="https://cdn.jsdelivr.net" crossOrigin="" />
        {/* 버전 고정(v1.3.9) CSS라 SRI 해시로 변조 방지. 버전을 올리면 해시도 재계산. */}
        <link
          rel="stylesheet"
          href="https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/variable/pretendardvariable-dynamic-subset.min.css"
          integrity="sha384-GIdEBaqGN9mNkDkMkzMHW8EKUqtpPIe/sLj1X7DIrnc9uPtLROJgmuDlh+3rBw0j"
          crossOrigin="anonymous"
        />
      </head>
      <body className="min-h-full flex flex-col">
        <AppAuthProvider enabled={clerkEnabled}>{children}</AppAuthProvider>
      </body>
    </html>
  );

  if (!clerkEnabled) return body;
  return (
    <ClerkProvider
      localization={koKR}
      // 로그인 팝업의 "가입" 링크 → 우리 가입 신청 폼(회사 이메일 검사)으로
      waitlistUrl="/?signup=1"
      afterSignOutUrl="/"
    >
      {body}
    </ClerkProvider>
  );
}
