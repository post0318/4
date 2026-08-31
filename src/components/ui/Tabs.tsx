import { cn } from "@/lib/ui";

interface TabsProps<K extends string> {
  tabs: readonly { key: K; label: string }[];
  active: K;
  onChange: (key: K) => void;
  className?: string;
}

/** 밑줄형 탭 바. */
export function Tabs<K extends string>({
  tabs,
  active,
  onChange,
  className,
}: TabsProps<K>) {
  return (
    <div
      role="tablist"
      className={cn(
        "flex flex-wrap gap-0.5 border-b border-zinc-200 dark:border-zinc-800",
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
              "-mb-px shrink-0 border-b-2 px-3.5 py-2.5 text-sm font-medium transition-colors outline-none focus-visible:bg-zinc-100 dark:focus-visible:bg-zinc-800",
              on
                ? "border-blue-600 text-blue-600 dark:border-blue-400 dark:text-blue-400"
                : "border-transparent text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100"
            )}
          >
            {t.label}
          </button>
        );
      })}
    </div>
  );
}
