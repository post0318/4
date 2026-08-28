import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "브라질 국채 매수 자동화",
  description:
    "환율·종목·수익률을 자동 반영하고, 원화 투자금액으로 매수수량을 산출해 주문 이메일을 준비하는 도구",
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
