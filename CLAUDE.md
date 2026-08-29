# 브라질 국채 매수 프로세스 자동화

## 프로젝트 개요

브라질 국채(NTN-F) 매수 주문 준비를 자동화하는 웹 도구. 환율·종목·수익률을 자동
표시하고, 원화 투자금액만 입력하면 달러 환전액과 매수가능수량(정수, 1좌 = 액면
R$1,000)을 산출해, 확인 체크 후 주문 이메일을 발송한다. 정식 규칙은 PRD.md 참고.

`post0318/3`(브라질 NTN-F 신탁 계산기)의 검증된 모듈(ANBIMA PU 공식, 브라질
영업일 캘린더, Frankfurter FX, NTN-F 스냅샷 파이프라인)을 재사용해 빈 프로젝트로
새로 시작했다.

## 기술스택

- Next.js 16 (app router, Turbopack) / React 19 / TypeScript
- Tailwind CSS 4
- Vercel 배포
- NTN-F 시세는 레포에 커밋된 스냅샷(`src/lib/server/ntnf-snapshot.json`)을 쓰고,
  GitHub Actions가 주간 갱신한다(`scripts/fetch-ntnf-snapshot.mjs`). 원본 CSV가
  14MB라 요청 시점에 못 받는다.
- 환율은 Frankfurter.dev(ECB 기준, 무인증) — 중간환율, 참고용.

## 코드규칙

- TypeScript 사용
- 컴포넌트는 `src/components/` 아래
- 환경변수는 `.env.local`에 저장 (커밋 금지). 예시는 `.env.example`.
- 모바일 반응형
- 브라질 NTN-F 전용 — 다른 국가/통화/상품 코드를 들여오지 않는다

## 구조

- `src/lib/ntnfPricing.ts` — 매수단가(PU) ANBIMA 공식, 결제일(D+0 브라질 영업일)
- `src/lib/ntnfMeta.ts` — 만기연도 → ISIN·종목명 정적 맵 (2037 ISIN 미확인)
- `src/lib/quantity.ts` — KRW→USD→BRL→수량(정수 절사) 순수 함수
- `src/lib/orderEmail.ts` — 주문 이메일 제목/본문 생성
- `src/app/api/fx-rates` — USD/KRW·USD/BRL 조회, KRW/BRL 파생
- `src/app/api/fx-history` — 7년치 일간 환율 추이(Frankfurter 시계열, 12h 재검증)
- `src/app/api/br-selic` — 브라질 기준금리(Selic) 7년 추이(BCB SGS 432, 무인증)
- `src/app/api/br-news` — 브라질 뉴스 5건(G1 RSS + MyMemory pt→ko, 30m 재검증)
- `src/app/api/br-agenda` — 향후 1개월 경제지표(IBGE 캘린더)·시장 휴장일
- `src/app/api/br-bond-search` — 스냅샷 + 메타 머지
- `src/app/api/send-order` — 서버 재계산 대조 후 발송. **이메일 전송은 현재
  stub** — `sendEmail()` 어댑터에 Resend 또는 Gmail SMTP 연결하면 됨.

## 이메일 발송 (미완)

`src/app/api/send-order/route.ts`의 `sendEmail()`가 `{ delivered: false }`를
반환하는 stub 상태다. 실제 연동 시 `.env`에 키를 넣고 그 함수만 채우면 된다.
확인 체크박스·요약 모달·서버 재계산 대조 로직은 이미 동작한다.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
