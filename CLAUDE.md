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
  GitHub Actions가 매일 갱신한다(`scripts/fetch-ntnf-snapshot.mjs`). 원본 CSV가
  14MB라 요청 시점에 못 받는다.
- 정부 CSV(tesourotransparente.gov.br)가 2026-09-19부터 며칠씩 멈추는 사고가
  있어(파일은 재발행돼도 속 데이터 Data Base가 안 바뀜), 스크립트가 거래
  플랫폼(tesourodireto.com.br) 실시간 API로 값을 보정한다(오너 지시,
  2026-09-24) — 매도가(6종목)·매수가(신규모집 중인 종목만, 보통 1개)만.
  `buyLive`/`sellLive`·`liveAsOfDate`로 화면에 구분 표시. 옛 JSON API
  (`treasurybondsinfo.json`)는 2025-08부터 410 Gone, 그 후속인
  `/o/rentabilidade/{resgatar,investir}`가 지금 쓰는 경로다.
- 환율은 Frankfurter.dev(ECB 기준, 무인증) — 중간환율, 참고용.

## 코드규칙

- TypeScript 사용
- 컴포넌트는 `src/components/` 아래
- 환경변수는 `.env.local`에 저장 (커밋 금지). 예시는 `.env.example`.
- 모바일 반응형
- 브라질 NTN-F 전용 — 다른 국가/통화/상품 코드를 들여오지 않는다

## 구조

- `src/lib/ntnfPricing.ts` — 매수단가(PU) ANBIMA 공식, 결제일(주문일 D+1 브라질 영업일). 매수수익률은 Taxa Compra
- `src/lib/ntnfMeta.ts` — 만기연도 → ISIN·종목명 정적 맵 (2027~2037 ISIN 확인 완료)
- `src/lib/quantity.ts` — KRW→USD→BRL→수량(정수 절사) 순수 함수 +
  `distributeUsdByKrwWeight`(환전 달러금액을 종목별 원화투자금액 비중대로 2자리
  절사 배분, 잔동은 최대 종목 가산). 절사는 `format.ts`의 `truncDecimals`(부동소수
  표현오차 보정)
- `src/lib/orderEmail.ts` — 주문 이메일 제목/본문 생성
- `src/lib/cashflow/trustSimulation.ts` — **현재 시뮬레이션 탭의 엔진**.
  현금흐름 탭과 같은 `computeBondPricing` + `generateFixCashFlow` +
  `computeMaturitySummary` 를 구간(leg)마다 돌려 네 전략을 비교한다:
  만기보유 · 롤오버(A 만기상환 → B) · 갈아타기(A 중도매도 → B) · 중도해지.
  후취보수·세금·경과이자의 원금 차감이 현금흐름 탭과 한 규칙으로 맞는다.
  `simulateHold` 결과는 현금흐름 탭 숫자와 정확히 일치해야 한다(회귀 기준).
  · `TrustLeg.rolloverKrw` = 마지막 회차 지급액(재투자 가능한 돈),
    `paidOutKrw` = 도중 이미 지급된 쿠폰. **재투자는 rolloverKrw 만** 넣는다 —
    반기지급형이라 중간 쿠폰은 신탁에 없다. 총수령액에는 paidOutKrw 를 더한다.
  · 중도청산은 `cashFlowSchedule.ts` 의 `earlyExit` 입력으로 처리한다.
    현금흐름 탭은 이 입력을 넣지 않아 결과가 그대로다(고객용 만기보유 자료).
  · **재투자 기준** — `simulateReinvestHold/Rollover/Switch/Termination`.
    쿠폰으로 같은 종목을 더 사서 좌수를 불린다. 좌수 증가 방식은 현금흐름 탭
    재투자형(`generateReinvestCashFlow`)을 그대로 따른다(오너 지시 2026-09-17).
    중도청산은 `ReinvestCashFlowInputs.earlyExit` — 현금흐름 탭은 넣지 않아
    결과 불변. 반기지급형과 달리 중간에 나가는 돈이 없어 구간 종료 시 전액이
    다음 구간 원금이 된다. 화면에는 4전략 표 아래 별도 박스로 두되
    **롤오버·갈아타기만** 보인다(오너 지시 2026-09-17 — 재투자 여부로 결론이
    갈리는 지점이 두 전략의 비교라서). 만기보유·중도해지 재투자 함수도 엔진에는
    있다.
  · `breakEvenReinvestPct` — 중도해지금을 남은 기간 연 몇 %로 굴려야
    만기보유와 같아지는가. **화면에는 내렸다**(오너 지시, 2026-09-17 —
    "억지로 재투자를 안하는데 재투자를 가정하는게 더 이상하다"). 함수는 남겨둔다.
- `src/lib/ntnfSimulation.ts` — `holdToMaturityBrl` 하나만 남았다(「금리/환율
  민감도」 탭 전용). 옛 롤오버·갈아타기 계산과 「시뮬레이션 원본」 탭은
  2026-09-17 에 삭제했다 — 채권 거래만 봐서 후취보수·세금·경과이자가 빠져
  현금흐름 탭과 숫자가 어긋났다
- `src/lib/simulationState.ts` — 시뮬레이션 탭 입력값 정의(`SimulationState`,
  `createSimulationState`). `OrderConsole` 이 보유하고 sessionStorage 에 남긴다
- `src/lib/ntnfDuration.ts` — PU 공식 수치미분으로 수정듀레이션·컨벡시티·DV01,
  금리·환율 쇼크 시 가격/원화가치 변동. `DurationPanel`
- 탭: 시장정보 · 현금흐름 · 시뮬레이션 · 금리/환율 민감도 · 트레이딩
  (`OrderConsole`). 처음 들어오면 시장정보, 새로고침하면 보던 탭으로
  돌아온다(sessionStorage `ntnf.tab.v1`). 공유 링크로 들어오면 항상 현금흐름
- `src/components/TrustStrategyPanel.tsx` — 시뮬레이션 탭. 입력을 **자기가**
  받는다(현금흐름 탭을 참조하지 않는다 — 그 탭이 비어 있으면 아예 안 뜨던 문제).
  입력 격자는 4열 × 4행으로 오너가 지정한 배치다:
  1행 신탁투자원금·신탁보수 선취·후취 신탁보수·빈칸 (아래는 점선 구분),
  2행 보유종목A·최초투자시점·중도매도 시점·갈아탈종목B,
  3행 헤알화환율·A 매수수익률·A 중도매도수익률·B 매수수익률,
  4행 매도시 헤알화환율·A 매수가격·A 매도가격·B 매수가격
  (실제 배치는 `SLOT_ORDER` 하나로 관리한다).
  매수가격·매도가격(R$)을 직접 넣으면 `impliedYieldFromBrazilPrice` 로 그 단가를
  내는 수익률을 역산해 엔진에 넣는다(엔진이 수익률만 받기 때문).
  고정값이라 입력에 두지 않는 것: 표면이율 10% · 이자지급 6개월 ·
  Business/252 · 종합소득세율 15.4% · 과세여부 비과세 · 롤오버 선취보수 0% ·
  현금성이율 0%. 화면 설명줄에 그대로 적어둔다.
  표의 지표 — 「단리(연)」는 총수익률 × 365 ÷ 투자일수로 현금흐름 탭의
  「세후수익률」과 같은 기준이고, 「복리 최고」 배지는 복리(연) 열에서 가장 높다는
  뜻일 뿐이다(기간이 짧을수록 복리가 높게 나오니 기간 열을 함께 본다).
  이 엔진은 반기지급형이라 **쿠폰을 재투자하지 않는다** — 재투자하면 일찍 옮겨
  탄 쪽(갈아타기)이 유리해질 수 있다. 화면에 적던 이 설명은 오너 지시로
  내렸으므로(2026-09-17) 여기서만 확인한다.
  **전략 카드가 이 탭의 핵심 화면**(오너 지시) — 좌수 증가 · 기간 막대 ·
  총 기대수익률 · 4항 분해(만기효과A + 만기효과B + 증분효과 + 이자효과, 합이
  총수익률과 일치) · A 청산단가/B 매수가격/기간. 증분효과가 잔차라 후취보수·
  세금까지 떠안는다
- `src/components/CurrencyExchange.tsx` — 환전금액(원화금액÷고시환율=달러금액).
  제어 컴포넌트, 원화금액이 종목별 원화투자금액 합계·달러 배분의 기준
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
- `src/app/api/br-agenda` — 한 달 전 ~ 2개월 후 경제지표(IBGE 캘린더)·시장 휴장일·
  대선 일정
- `src/app/api/br-bond-search` — 스냅샷 + 메타 머지 + 신선도(ageDays·stale, 10일 초과 시 화면 경고).
  현금흐름 탭 `api/cashflow/br-bond-search`도 **같은** 스냅샷을 읽는다(사본 폴더 제거됨)
- 현금흐름 공유 링크 — 생성·해석 모두 서버. `src/lib/cashflow/shareCodec.ts`(입력값
  바이너리 패킹, 고객모드·발급일 포함) + `src/lib/server/shareLink.ts`. 두 방식:
  서명형 `?p=`(HMAC 64비트, `SHARE_LINK_SECRET`, 저장소 불필요) · 서버저장형
  `?t=`(10자 토큰, Upstash Redis, 로컬은 `.data/share-links.json`, TTL 180일).
  옛 `?bond=` lz-string 링크는 읽기만 호환. `page.tsx`가 `resolveShareLink`로 해석해
  `OrderConsole`에 props 로 내림(브라우저에서 URL 을 읽지 않는다)
- `src/app/api/send-order` — 서버 재계산 대조 후 발송. **이메일 전송은 현재
  stub** — `sendEmail()` 어댑터에 Resend 또는 Gmail SMTP 연결하면 됨.

## 로그인 (Clerk)

트레이딩 탭·주문 발송 API·수신자 기본값·공유 링크 생성은 승인된 회사 계정만.
`src/proxy.ts`(clerkMiddleware) → `src/lib/server/appAuth.ts`의 `requireTradingUser()`
로 API 잠금, 화면은 `TradingGate`(로그인 팝업·가입 신청)와 `useAppAuth()`
(`src/components/auth/AppAuth.tsx`, Clerk 키 없으면 비활성 값). Clerk 는 대기자
(Waitlist) 모드 — 가입 신청 → 관리자가 dashboard.clerk.com 에서 승인. 회사 도메인
검사는 `ALLOWED_EMAIL_DOMAINS`(기본 hanwha.com)로 가입 폼·서버 양쪽에서, 관리자는
`ADMIN_EMAILS`로 도메인 예외. 허용 판정은 서버 `/api/auth/me`가 내리고 화면은 그 결과만 쓴다.
관리자는 계정 버튼 메뉴 「승인 관리」→ `/admin`(`AdminAccounts`, `/api/admin/accounts`)에서
대기자 승인(초대 메일)·거절, 사용자 접근 차단·해제를 Clerk Backend API 로 처리한다. 탭 순서는
시장정보·현금흐름·시뮬레이션·민감도·트레이딩. 나머지 탭과 조회 API 는 공개.

## 이메일 발송 (미완)

`src/app/api/send-order/route.ts`의 `sendEmail()`가 `{ delivered: false }`를
반환하는 stub 상태다. 실제 연동 시 `.env`에 키를 넣고 그 함수만 채우면 된다.
확인 체크박스·요약 모달·서버 재계산 대조 로직은 이미 동작한다.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
