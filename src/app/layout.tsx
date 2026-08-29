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
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
