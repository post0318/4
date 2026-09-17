import { toISODate, today } from "@/lib/ntnfPricing";

/**
 * 시뮬레이션 탭 입력값.
 *
 * `OrderConsole` 이 보유해 탭을 옮겨도 유지되고(감사 ⑤ 중7), sessionStorage 에
 * 남아 새로고침에도 살아남는다. 화면(`TrustStrategyPanel`)과 분리해 둔 이유는
 * 옛 시뮬레이션 컴포넌트가 이 정의를 들고 있어서 그 파일을 지우면 함께
 * 사라졌기 때문이다(2026-09-17 정리).
 *
 * 화면 배치는 4열 × 4행이다:
 *   1행 신탁투자원금 · 신탁보수 선취 · 후취 신탁보수 · (공란)
 *   2행 보유종목A · 최초투자시점 · 중도매도 시점 · 갈아탈 종목B
 *   3행 헤알화환율 · A 매수수익률 · A 중도매도수익률 · B 매수수익률
 *   4행 매도시 헤알화환율 · A 매수가격 · A 매도가격 · B 매수가격
 */
export interface SimulationState {
  /** 신탁투자원금 (원) */
  principalKrw: string;
  /** 보유종목 A 의 만기일 (선택 키) */
  aKey: string;
  /** 갈아탈 종목 B 의 만기일 (선택 키) */
  bKey: string;
  /** A 매수수익률 (%) — 비우면 시세 */
  aYield: string;
  /** B 매수수익률 (%) — 비우면 시세 */
  bYield: string;
  /** 최초투자시점 */
  buyDate: string;
  /** A 중도매도수익률 (%) — 비우면 매수수익률과 동일 */
  sellYield: string;
  /** 중도매도 시점 */
  sellDate: string;
  /** 헤알화환율 (원/헤알) — 비우면 시세(소수 2자리) */
  fxRate: string;
  /** 매도시 헤알화환율 (원/헤알) — 비우면 매수시점과 동일 */
  exitFxRate: string;
  /** 신탁보수 선취 (%) — 최초매수·갈아타기에 함께 쓴다 */
  trustFee: string;
  /** 후취 신탁보수 (%, 연) */
  backFee: string;
  /** A 매수가격 (R$) 수기 지정 — 넣으면 그 단가를 내는 수익률로 역산 */
  buyPriceA: string;
  /** A 매도가격 (R$) 수기 지정 */
  sellPriceA: string;
  /** B 매수가격 (R$) 수기 지정 */
  buyPriceB: string;
}

const DEFAULT_PRINCIPAL_KRW = "100000000";
const DEFAULT_TRUST_FEE = "1.5";
const DEFAULT_BACK_FEE = "0.5";

/** 중도매도 시점 기본값 = 최초투자시점 + 1년 */
function defaultSellDate(from: Date): string {
  const d = new Date(from);
  d.setUTCFullYear(d.getUTCFullYear() + 1);
  return toISODate(d);
}

/** 기본 입력값 (오늘 기준). 초기화 버튼도 이것으로 되돌린다. */
export function createSimulationState(): SimulationState {
  const n = today();
  return {
    principalKrw: DEFAULT_PRINCIPAL_KRW,
    aKey: "",
    bKey: "",
    aYield: "",
    bYield: "",
    buyDate: toISODate(n),
    sellYield: "",
    sellDate: defaultSellDate(n),
    fxRate: "",
    exitFxRate: "",
    trustFee: DEFAULT_TRUST_FEE,
    backFee: DEFAULT_BACK_FEE,
    buyPriceA: "",
    sellPriceA: "",
    buyPriceB: "",
  };
}
