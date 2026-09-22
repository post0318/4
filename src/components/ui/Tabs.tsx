import type { ComponentType, ReactNode, SVGProps } from "react";
import { cn } from "@/lib/ui";

interface TabsProps<K extends string> {
  /** icon 은 lucide 아이콘 컴포넌트(선택) — 라벨 왼쪽에 작게 붙는다 */
  tabs: readonly {
    key: K;
    label: string;
    icon?: ComponentType<SVGProps<SVGSVGElement>>;
  }[];
  active: K;
  onChange: (key: K) => void;
  className?: string;
  /** 탭 줄 오른쪽 끝에 놓을 요소(예: 공유 링크 버튼) */
  trailing?: ReactNode;
}

/** 밑줄형 탭 바. */
export function Tabs<K extends string>({
  tabs,
  active,
  onChange,
  className,
  trailing,
}: TabsProps<K>) {
  return (
    <div
      role="tablist"
      className={cn(
        "flex flex-wrap items-center gap-0.5 border-b border-zinc-200 dark:border-zinc-800",
        className
      )}
    >
      {tabs.map((t) => {
        const on = t.key === active;
        return (
          <button
            key={t.key}
            type="button"
            role="tab"
            aria-selected={on}
            onClick={() => onChange(t.key)}
            className={cn(
              "-mb-px flex shrink-0 items-center gap-1.5 border-b-2 px-3.5 py-2.5 text-sm font-medium transition-colors outline-none focus-visible:bg-zinc-100 dark:focus-visible:bg-zinc-800",
              on
                ? "border-blue-600 text-blue-600 dark:border-blue-400 dark:text-blue-400"
                : "border-transparent text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100"
            )}
          >
            {t.icon && <t.icon aria-hidden="true" className="size-3.5 shrink-0" />}
            {t.label}
          </button>
        );
      })}
      {trailing && <div className="ml-auto flex items-center pb-1.5 pl-2">{trailing}</div>}
    </div>
  );
}
