import type { NextConfig } from "next";

// 보안 헤더 (감사 ⑤ 중11).
// - frame-ancestors 'none' / X-Frame-Options DENY: 다른 사이트가 이 앱을 iframe 으로
//   끼워 넣지 못하게 한다(고객 공유 링크 포함).
// - Referrer-Policy no-referrer: 외부 링크(뉴스 등)를 타고 나갈 때 우리 주소
//   (공유 링크 쿼리 포함)가 상대 사이트에 전달되지 않게 한다.
// - nosniff: 응답 MIME 스니핑 차단.
// CSP 는 script-src 까지 잡으면 Next 인라인 스크립트와 충돌하므로 frame-ancestors 만 둔다.
const securityHeaders = [
  { key: "Content-Security-Policy", value: "frame-ancestors 'none'" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "no-referrer" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
];

const nextConfig: NextConfig = {
  async headers() {
    return [{ source: "/(.*)", headers: securityHeaders }];
  },
};

export default nextConfig;
