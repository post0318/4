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
- `src/lib/ntnfSimulation.ts` — 신탁투자원금 기준 롤오버 vs 갈아타기 비교
  (`simulateRollVsSwitch`). 좌수는 현금흐름 탭 로직대로 (원금−선취)÷환율÷PU 절사,
  총기대수익률 = 증분효과 + 이자효과 + 잔돈. 쿠폰 재투자 없음, 단일환율.
  `SimulationPanel`(→`RollSwitchComparison`). `holdToMaturityBrl`은 `DurationPanel`용
- `src/lib/ntnfDuration.ts` — PU 공식 수치미분으로 수정듀레이션·컨벡시티·DV01,
  금리·환율 쇼크 시 가격/원화가치 변동. `DurationPanel`
- 탭: 시장정보 · 트레이딩 · 현금흐름 · 시뮬레이션 · 듀레이션 (`OrderConsole`)
- `src/components/CurrencyExchange.tsx` — 원화금액÷고시환율=달러금액 계산기(시장정보 탭)
- `src/app/api/fx-rates` — USD/KRW·USD/BRL 조회, KRW/BRL 파생
- `src/app/api/fx-history` — 7년치 일간 환율 추이(Frankfurter 시계열, 12h 재검증)
- `src/app/api/br-selic` — 브라질 기준금리(Selic) 7년 추이(BCB SGS 432, 무인증)
- `src/app/api/ntnf-yield` — 브라질 국채금리(NTN-F ~10년 롤링) 7년 추이. 커밋된
  `ntnf-yield-history.json`(주간 GitHub Actions 갱신)을 반환
- `src/app/api/br-news` — 현지 뉴스 최대 5건(좋은아침뉴스 `bomdianews.com.br`
  RSS, 한국어 원문·번역 불필요). `RELEVANT` 허용목록(금리·헤알·환율·국채·재정·
  세제·물가·무역·신용등급·정치 등)에 걸리는 글만 통과 → 관련 글이 적으면 5건
  미만. + 브라질 관련 글로벌 영문 뉴스(Google 뉴스, 제목 자동 번역,
  `GLOBAL_OFF_TOPIC`로 AI·스트리밍·스포츠·연예 제외, 현지의 ~1.4배·5~9건).
  30m 재검증
- `src/app/api/br-daily-report` — 한국브라질소사이어티(KOBRAS) 「브라질 데일리
  리포트」 최신호. 네이버 블로그 `dari0202` RSS에서 최신 글을 찾아 PostView 본문의
  [KOBRAS Daily Brief](핵심 분석) 섹션만 파싱. 1h 재검증
- `src/app/api/br-agenda` — 15일 전 ~ 2개월 후 경제지표(IBGE 캘린더)·시장 휴장일·
  대선 일정
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
