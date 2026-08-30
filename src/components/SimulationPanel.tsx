"use client";

import { RollSwitchComparison } from "@/components/RollSwitchComparison";
import type { BondItem, FxRates } from "@/lib/types";

interface Props {
  bonds: BondItem[];
  fx: FxRates | null;
}

/** 시뮬레이션 탭 — 롤오버 vs 갈아타기 비교. */
export function SimulationPanel({ bonds, fx }: Props) {
  return <RollSwitchComparison bonds={bonds} fx={fx} />;
}
