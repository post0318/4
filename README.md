# 브라질 국채 매수 프로세스 자동화

브라질 국채(NTN-F) 매수 주문 준비 도구. 환율·종목·수익률 자동 표시 → 원화
투자금액 입력 → 매수가능수량 산출 → 확인 후 주문 이메일 발송.

자세한 요구사항은 [PRD.md](./PRD.md), 코드 규칙은 [CLAUDE.md](./CLAUDE.md) 참고.

## 개발

```bash
npm install
npm run dev          # http://localhost:3000
npm run build
npm run lint
npm run refresh-ntnf # NTN-F 시세 스냅샷 수동 갱신
```

## 환경변수

`.env.example`를 `.env.local`로 복사해 채운다.

- `ORDER_EMAIL_TO` — 주문 이메일 수신자 기본값 (화면에서 수정 가능)
- `ORDER_EMAIL_GREETING` / `ORDER_EMAIL_SIGNATURE` — 주문 메일 인사말·서명
  (미설정 시 `src/lib/orderEmail.ts` 기본값). 인사말 줄바꿈은 리터럴 `\n`.

## 배포

Vercel에 GitHub 레포(`post0318/4`)를 연결한다. 환경변수는 Vercel 대시보드에
설정한다. NTN-F 시세 스냅샷은 GitHub Actions(`.github/workflows/refresh-ntnf.yml`)가
매주 갱신 커밋 → 재배포한다.

## 이메일 전송

현재 실제 전송은 **stub**이다(`src/app/api/send-order/route.ts`의 `sendEmail()`).
Resend API 키 또는 Gmail 앱 비밀번호를 확보하면 그 함수만 채우면 된다. 나머지
흐름(본문 생성, 확인 체크, 요약 모달, 서버 재계산 대조)은 완성되어 있다.
