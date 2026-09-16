"use client";

import type { Dispatch, SetStateAction } from "react";
import {
  RollSwitchComparison,
  type SimulationState,
} from "@/components/RollSwitchComparison";
import type { BondItem, FxRates } from "@/lib/types";

interface Props {
  bonds: BondItem[];
  fx: FxRates | null;
  state: SimulationState;
  onChange: Dispatch<SetStateAction<SimulationState>>;
}

/** 시뮬레이션 탭 — 롤오버 vs 갈아타기 비교. 입력값은 OrderConsole 이 보유. */
export function SimulationPanel({ bonds, fx, state, onChange }: Props) {
  return <RollSwitchComparison bonds={bonds} fx={fx} state={state} onChange={onChange} />;
}
