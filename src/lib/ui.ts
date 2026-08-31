/**
 * 화면 전반에서 재사용하는 클래스 토큰. 컴포넌트마다 조금씩 다르게 쓰던
 * 카드/버튼/입력/표 스타일을 여기 한 곳에서 정의해 한 시스템처럼 보이게 한다.
 */

/** 조건부 클래스 결합 (clsx 최소 구현) */
export function cn(
  ...parts: Array<string | false | null | undefined>
): string {
  return parts.filter(Boolean).join(" ");
}

/** 섹션 카드 컨테이너 (흰 표면 + 은은한 테두리·그림자) */
export const card =
  "rounded-xl border border-zinc-200/80 bg-white shadow-sm dark:border-zinc-800 dark:bg-zinc-950 dark:shadow-none";

/** 카드 기본 안쪽 여백 */
export const cardPad = "p-4 sm:p-5";

/** 섹션 제목 (카드 상단) */
export const sectionTitle =
  "text-sm font-semibold tracking-tight text-zinc-900 dark:text-zinc-100";

/** 입력 라벨 (작은 대문자 느낌) */
export const label =
  "block text-xs font-medium text-zinc-500 dark:text-zinc-400";

/** 텍스트 입력·select 공통 */
export const input =
  "w-full rounded-lg border border-zinc-300 bg-white px-2.5 py-1.5 text-sm text-zinc-900 outline-none transition-colors placeholder:text-zinc-400 focus-visible:border-blue-500 focus-visible:ring-2 focus-visible:ring-blue-500/25 disabled:cursor-not-allowed disabled:bg-zinc-50 disabled:text-zinc-400 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100 dark:disabled:bg-zinc-900";

/** 숫자 입력 (우측정렬 + 등폭숫자) */
export const numInput = `${input} text-right tabular-nums`;

/** 표 헤더 셀 */
export const th =
  "px-2.5 py-2 text-xs font-semibold text-zinc-500 dark:text-zinc-400 whitespace-nowrap";

/** 표 본문 셀 */
export const td = "px-2.5 py-2 text-[13px] whitespace-nowrap tabular-nums";

/** 보조 설명·각주 */
export const hint = "text-[11px] leading-relaxed text-zinc-400";

/** 등폭 숫자 */
export const tnum = "tabular-nums";

type BtnVariant = "primary" | "secondary" | "ghost";
type BtnSize = "sm" | "md";

const BTN_BASE =
  "inline-flex select-none items-center justify-center gap-1.5 rounded-lg font-medium transition-colors outline-none focus-visible:ring-2 focus-visible:ring-blue-500/30 disabled:cursor-not-allowed disabled:opacity-50";

const BTN_VARIANT: Record<BtnVariant, string> = {
  primary: "bg-blue-600 text-white hover:bg-blue-700 disabled:hover:bg-blue-600",
  secondary:
    "border border-zinc-300 bg-white text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-200 dark:hover:bg-zinc-900",
  ghost:
    "text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-300 dark:hover:bg-zinc-800 dark:hover:text-zinc-100",
};

const BTN_SIZE: Record<BtnSize, string> = {
  sm: "px-2.5 py-1 text-xs",
  md: "px-3.5 py-2 text-sm",
};

/** 버튼 클래스 (variant·size). primary=강조, secondary=보조, ghost=최소 */
export function btn(variant: BtnVariant = "secondary", size: BtnSize = "md") {
  return cn(BTN_BASE, BTN_VARIANT[variant], BTN_SIZE[size]);
}
