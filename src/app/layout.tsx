import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "브라질 트레이딩",
  description:
    "브라질 환율·기준금리·뉴스·일정과 NTN-F 매수 주문 준비를 한 화면에서 다루는 도구",
  robots: {
    index: false,
    follow: false,
  },
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
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
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
