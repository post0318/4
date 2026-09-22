import type { ReactNode } from "react";
import { card, cardPad, cn, sectionTitle } from "@/lib/ui";

interface CardProps {
  children: ReactNode;
  className?: string;
}

/** 섹션 카드 — 화면의 기본 블록. */
export function Card({ children, className }: CardProps) {
  return <section className={cn(card, cardPad, className)}>{children}</section>;
}

interface CardHeaderProps {
  title: ReactNode;
  /** 제목 우측 영역 (새로고침 버튼 등) */
  action?: ReactNode;
  className?: string;
}

/** 카드 상단 제목 줄 (좌: 제목/부제, 우: 액션) */
export function CardHeader({ title, action, className }: CardHeaderProps) {
  return (
    <div className={cn("mb-3 flex items-start justify-between gap-3", className)}>
      <div className="min-w-0">
        <h2 className={sectionTitle}>{title}</h2>
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}
