"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { FxRatePanel } from "@/components/FxRatePanel";
import { Tabs } from "@/components/ui/Tabs";
import { CalendarDays, CandlestickChart, Gauge, GitCompareArrows, Newspaper } from "lucide-react";
import { Button } from "@/components/ui/Button";
import {
  CurrencyExchange,
  deriveExchange,
  EMPTY_EXCHANGE,
  type ExchangeState,
} from "@/components/CurrencyExchange";
import { TrustStrategyPanel } from "@/components/TrustStrategyPanel";
import {
  createSimulationState,
  type SimulationState,
} from "@/lib/simulationState";

/** 시뮬레이션 입력 보관 키 (탭 단위) */
const SIM_STATE_KEY = "ntnf.simulation.v1";
/** 마지막으로 보던 탭 보관 키 (탭 단위) */
const TAB_KEY = "ntnf.tab.v1";
const TAB_KEYS = ["market", "cashflow", "simulation", "duration", "trading"] as const;
type TabKey = (typeof TAB_KEYS)[number];
import { DurationPanel, createDurationState } from "@/components/DurationPanel";
import { BRAZIL_FLAG_DATA_URI } from "@/lib/brazilFlag";
import { BrazilBriefing } from "@/components/BrazilBriefing";
import { CashFlowPanel } from "@/components/CashFlowPanel";
import { ClientViewGuard } from "@/components/ClientViewGuard";
import type { ShareResolution } from "@/lib/server/shareLink";
import { UserButton } from "@clerk/nextjs";
import { useAppAuth } from "@/components/auth/AppAuth";
import { TradingGate } from "@/components/auth/TradingGate";
import { SignupDialog } from "@/components/auth/SignupDialog";
import { ShareLinkButton } from "@/components/cashflow/ShareLinkButton";
import { createDefaultInput } from "@/components/CashFlowPanel";
import type { BondLayoutInput } from "@/lib/cashflow/bondLayout";
import { BondOrderTable, type BondRow } from "@/components/BondOrderTable";
import { OrderReview, type PendingLine } from "@/components/OrderReview";
import {
  computeNtnfPu,
  getOrderSettlementDate,
  toISODate,
  today,
} from "@/lib/ntnfPricing";
import {
  computeOrder,
  distributeUsdByKrwWeight,
  isValidOrderInputs,
} from "@/lib/quantity";
import { truncDecimals } from "@/lib/format";
import type { BondItem, BondSearchResponse, FxRates, QuoteFreshness } from "@/lib/types";

interface OrderConsoleProps {
  /** 서버가 해석한 공유 링크. 링크가 아니면 null. */
  share: ShareResolution | null;
  /** 고객 모드 링크 열람자 IP (워터마크용). 서버가 요청 헤더에서 읽는다. */
  viewerIp?: string | null;
  /** 트레이딩 탭 가입·사용이 허용되는 회사 이메일 도메인 */
  allowedDomains: string[];
  /** `/?signup=1` — 가입 신청 폼을 바로 연다 */
  openSignup?: boolean;
}

export function OrderConsole({
  share,
  viewerIp = null,
  allowedDomains,
  openSignup = false,
}: OrderConsoleProps) {
  // 트레이딩 탭·주문 발송은 승인된 회사 계정만 (감사 ⑤ 치명1). 서버 API 도 같은 기준.
  const auth = useAppAuth();
  const tradingUnlocked = auth.enabled && auth.isSignedIn && auth.allowed === true;

  const [fx, setFx] = useState<FxRates | null>(null);
  const [fxLoading, setFxLoading] = useState(true);
  const [fxError, setFxError] = useState<string | null>(null);

  const [bonds, setBonds] = useState<BondItem[]>([]);
  const [asOfDate, setAsOfDate] = useState<string | null>(null);
  const [quote, setQuote] = useState<QuoteFreshness | null>(null);
  const [bondLoading, setBondLoading] = useState(true);
  const [bondError, setBondError] = useState<string | null>(null);

  // 고객 공유 링크(고객 모드)면 트레이딩(주문) 탭 숨김 + 인쇄·복사 차단.
  // 서버가 해석해 내려주므로 서버 HTML 과 첫 클라이언트 렌더가 같다.
  const shareOk = share?.status === "ok" ? share : null;
  const hideTrading = shareOk?.meta.client ?? false;
  const clientIssued = shareOk?.meta.issued ?? null;
  const shareInput = shareOk?.input ?? null;
  const shareProblem =
    share && share.status !== "ok"
      ? share.status === "expired"
        ? "공유 링크의 유효기간이 지났습니다. 새 링크를 요청하세요."
        : share.status === "unavailable"
          ? "공유 링크를 확인할 수 없습니다(서버 설정 누락). 관리자에게 문의하세요."
          : "공유 링크가 손상되었거나 변조되었습니다. 링크를 다시 확인하세요."
      : null;
  /**
   * 탭 위치 — 처음 들어오면 시장정보, 새로고침하면 보던 탭으로
   * 돌아온다(오너 지시 2026-09-22 — 전에는 늘 현금흐름이었다).
   * 시뮬레이션 입력과 같은 sessionStorage·브라우저 탭 단위.
   *
   * 공유 링크로 들어오면 링크가 담은 현금흐름부터 보여준다.
   */
  const [tab, setTab] = useState<TabKey>(shareOk ? "cashflow" : "market");

  /**
   * 저장된 탭 복원은 마운트 뒤에 한다 — 초기값에서 sessionStorage 를
   * 읽으면 서버 HTML 과 어긋난다. 고객 공유 링크는 복원하지 않는다
   * (받은 사람엔 늘 현금흐름부터).
   */
  const [tabRestored, setTabRestored] = useState(false);
  useEffect(() => {
    /* eslint-disable react-hooks/set-state-in-effect --
       서버 HTML 과 같은 값으로 그린 뒤 마운트 직후 한 번 맞춰 주는
       것이라 캐스케이딩 렌더링이 아니다. */
    if (shareOk) {
      setTabRestored(true);
      return;
    }
    try {
      const saved = sessionStorage.getItem(TAB_KEY);
      if (saved && (TAB_KEYS as readonly string[]).includes(saved)) {
        setTab(saved as TabKey);
      }
    } catch {
      // 시크릿 모드·저장 차단 — 기본 탭 그대로
    }
    setTabRestored(true);
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [shareOk]);

  /**
   * 복원된 탭이 트레이딩인데 로그인 전이면 클릭했을 때처럼 로그인
   * 팝업을 띄운다. 복원은 `changeTab` 을 거치지 않아 그 분기를 건너뛰었다.
   * 한 번만 — 팝업을 닫은 사람에게 다시 들이밀지 않는다.
   */
  const restoreSignInShown = useRef(false);
  useEffect(() => {
    if (restoreSignInShown.current) return;
    if (!tabRestored || tab !== "trading") return;
    if (!auth.enabled || !auth.isLoaded || auth.isSignedIn) return;
    restoreSignInShown.current = true;
    auth.openSignIn();
  }, [tabRestored, tab, auth]);

  // 현금흐름 입력값·잠금 — 여기서 보유해 탭을 옮겨도 유지되고(감사 ⑤ 중7),
  // 탭 줄의 공유 링크 버튼이 같은 값을 쓴다.
  const isSharedLink = shareInput !== null;
  const [cfInput, setCfInput] = useState<BondLayoutInput>(() =>
    shareInput ? { ...createDefaultInput(), ...shareInput } : createDefaultInput()
  );
  const [cfLocked, setCfLocked] = useState<boolean>(isSharedLink);
  /**
   * 시뮬레이션·민감도 입력값도 여기서 보유 — 탭을 옮겨도 유지(감사 ⑤ 중7).
   *
   * 시뮬레이션은 새로고침에도 살아남게 sessionStorage 에 남긴다(오너 신고,
   * 2026-09-17 — "새로고침하니 원래 하던 시뮬레이션 맛이가면서 사라졌다").
   * 종목·금리·환율을 여러 개 맞춰놓고 보는 화면이라 한 번 날아가면 다시
   * 세팅하는 품이 크다. 탭(브라우저 탭) 단위라 창을 닫으면 사라진다.
   *
   * 읽을 때는 항상 기본값 위에 덮어쓴다 — 옛 버전이 남긴 값에 새로 생긴 칸이
   * 없으면 undefined 가 흘러들어 계산이 통째로 비어버린다.
   */
  const [simState, setSimState] = useState<SimulationState>(() => {
    const base = createSimulationState();
    try {
      const raw = sessionStorage.getItem(SIM_STATE_KEY);
      if (!raw) return base;
      const saved = JSON.parse(raw) as Partial<SimulationState>;
      return { ...base, ...saved };
    } catch {
      return base; // 시크릿 모드·저장 차단 등 — 기본값으로 시작
    }
  });
  useEffect(() => {
    try {
      sessionStorage.setItem(SIM_STATE_KEY, JSON.stringify(simState));
    } catch {
      // 저장 실패는 무시 — 이번 세션에서 기억만 안 될 뿐 화면은 그대로 동작
    }
  }, [simState]);
  const [durState, setDurState] = useState(createDurationState);
  // 가입 신청 팝업 (헤더 링크·트레이딩 안내·/?signup=1 에서 연다)
  const [signupOpen, setSignupOpen] = useState(openSignup);
  // 트레이딩 탭을 눌렀는데 로그인 전이면 로그인 팝업을 바로 띄운다.
  // 새로고침하면 돌아오도록 고른 탭을 남긴다(고객 공유 링크는 제외).
  const changeTab = (k: TabKey) => {
    setTab(k);
    if (!shareOk) {
      try {
        sessionStorage.setItem(TAB_KEY, k);
      } catch {
        // 저장 실패는 무시 — 이번 새로고침에서 기억만 안 될 뿐
      }
    }
    if (k === "trading" && auth.enabled && auth.isLoaded && !auth.isSignedIn) auth.openSignIn();
  };

  const [checkedKeys, setCheckedKeys] = useState<string[]>([]);
  const [amounts, setAmounts] = useState<Record<string, string>>({});
  // 환전금액(원화금액·달러금액·고시환율). 원화금액이 종목별 원화투자금액 합계의
  // 기준이 되고, 달러금액은 종목별 달러($) 자동값 배분의 기준이 된다.
  const [exchange, setExchange] = useState<ExchangeState>(EMPTY_EXCHANGE);
  // 달러($) override. 값이 없으면 원화투자금액 ÷ 환율 자동값을 쓴다.
  const [usdOverrides, setUsdOverrides] = useState<Record<string, string>>({});
  // 실제 주문수량 override. 값이 없으면 매수가능수량을 그대로 쓴다.
  const [orderQtys, setOrderQtys] = useState<Record<string, string>>({});
  // 수량계산 안전 버퍼(%) — 주문↔체결 시점차 가격·환율 변동 대비
  const [buffer, setBuffer] = useState("");
  const [defaultTo, setDefaultTo] = useState("");
  const [defaultCc, setDefaultCc] = useState("");

  const applyFxResponse = useCallback((d: FxRates & { error?: string }) => {
    if (d.error || typeof d.usdKrw !== "number") {
      setFxError(d.error ?? "환율 조회 실패");
      setFx(null);
      return;
    }
    setFxError(null);
    setFx({
      usdKrw: d.usdKrw,
      usdBrl: d.usdBrl,
      krwBrl: d.krwBrl,
      asOf: d.asOf,
      rateDate: d.rateDate ?? null,
    });
  }, []);

  const loadFx = useCallback(() => {
    setFxLoading(true);
    setFxError(null);
    fetch("/api/fx-rates")
      .then((r) => r.json())
      .then(applyFxResponse)
      .catch(() => setFxError("환율 조회 중 오류가 발생했습니다."))
      .finally(() => setFxLoading(false));
  }, [applyFxResponse]);

  useEffect(() => {
    let cancelled = false;

    // 세 요청은 서로 독립이라 병렬로 보낸다(예전엔 직렬 await라 종목 표가 환율
    // 응답을 기다렸다). 실패는 각자의 에러 state에만 반영한다.
    const loadFxInitial = (async () => {
      try {
        const d = await fetch("/api/fx-rates").then((r) => r.json());
        if (!cancelled) applyFxResponse(d);
      } catch {
        if (!cancelled) setFxError("환율 조회 중 오류가 발생했습니다.");
      } finally {
        if (!cancelled) setFxLoading(false);
      }
    })();

    const loadBonds = (async () => {
      try {
        const d: BondSearchResponse & { error?: string } = await fetch(
          "/api/br-bond-search"
        ).then((r) => r.json());
        if (!cancelled) {
          if (d.error || !Array.isArray(d.bonds)) {
            setBondError(d.error ?? "종목 조회 실패");
          } else {
            setBonds(d.bonds);
            setAsOfDate(d.asOfDate ?? null);
            setQuote({
              asOfDate: d.asOfDate ?? null,
              ageDays: d.ageDays ?? null,
              stale: d.stale === true,
            });
          }
        }
      } catch {
        if (!cancelled) setBondError("종목 조회 중 오류가 발생했습니다.");
      } finally {
        if (!cancelled) setBondLoading(false);
      }
    })();

    void Promise.allSettled([loadFxInitial, loadBonds]);

    return () => {
      cancelled = true;
    };
  }, [applyFxResponse]);

  // 기본 수신자·참조는 로그인(승인 계정) 후에만 조회 — API 가 잠겨 있다.
  useEffect(() => {
    if (!tradingUnlocked) return;
    let cancelled = false;
    (async () => {
      try {
        const r = await fetch("/api/send-order");
        if (!r.ok) return;
        const d: { defaultTo?: string; defaultCc?: string } = await r.json();
        if (!cancelled && d.defaultTo) setDefaultTo(d.defaultTo);
        if (!cancelled && d.defaultCc) setDefaultCc(d.defaultCc);
      } catch {
        /* 기본 수신자 없음 — 무시 */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [tradingUnlocked]);

  const settlement = useMemo(() => getOrderSettlementDate(today()), []);
  const settlementDate = toISODate(settlement);
  const orderDate = toISODate(today());

  const toggle = useCallback((key: string) => {
    setCheckedKeys((prev) =>
      prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]
    );
  }, []);

  const changeAmount = useCallback((key: string, value: string) => {
    setAmounts((prev) => ({ ...prev, [key]: value }));
  }, []);

  const changeUsd = useCallback((key: string, value: string) => {
    setUsdOverrides((prev) => ({ ...prev, [key]: value }));
  }, []);

  const changeOrderQty = useCallback((key: string, value: string) => {
    setOrderQtys((prev) => ({ ...prev, [key]: value }));
  }, []);

  const derivedExchange = useMemo(
    () => deriveExchange(exchange, fx?.usdKrw ?? null),
    [exchange, fx]
  );

  // 실효 원/달러: 환전금액의 고시환율을 사용자가 고쳤으면 그 값, 아니면 API 값.
  // 1좌당 매수가격(₩)·서버 재계산 대조에 모두 이 값을 쓴다(감사 ⑤ 낮음 —
  // 예전엔 달러 환전은 수정값, 1좌당 원화가격은 API 값이라 표 안에서 기준이 엇갈렸다).
  const effectiveFx: FxRates | null = useMemo(() => {
    if (!fx) return null;
    if (derivedExchange.rateEdited && derivedExchange.rate > 0) {
      const usdKrw = derivedExchange.rate;
      return { ...fx, usdKrw, krwBrl: usdKrw / fx.usdBrl };
    }
    return fx;
  }, [fx, derivedExchange.rateEdited, derivedExchange.rate]);

  const rows: BondRow[] = useMemo(() => {
    // 환전금액의 달러금액이 있으면 종목별 달러($) 자동값을 원화투자금액 비중대로
    // 나눠 채운다(2자리 절사·잔동은 최대 종목 가산). 없으면 종전대로 종목별
    // 원화투자금액 ÷ 원/달러 환율.
    const useDistribution = derivedExchange.usdTotal > 0;
    const distMap = useDistribution
      ? distributeUsdByKrwWeight(
          derivedExchange.usdTotal,
          bonds
            .filter((b) => checkedKeys.includes(b.maturityDate))
            .map((b) => ({
              key: b.maturityDate,
              krw: Number(amounts[b.maturityDate] ?? "") || 0,
            }))
        )
      : null;

    return bonds.map((bond) => {
      const key = bond.maturityDate;
      const checked = checkedKeys.includes(key);
      const krwInput = amounts[key] ?? "";
      const pu =
        bond.buyYieldPct === null
          ? null
          : computeNtnfPu(bond.maturityDate, bond.buyYieldPct, settlement);

      // 달러($): 자동값(비중 배분 또는 원화 ÷ 환율), 있으면 사용자 수정값
      const krwNum = Number(krwInput);
      let autoUsd: number | null;
      if (distMap) {
        autoUsd = checked && krwNum > 0 ? (distMap[key] ?? 0) : null;
      } else {
        // 폴백: 종목 원화투자금액 ÷ 환율. 사용자가 고시환율을 고쳤으면 그 값,
        // 아니면 자동 조회 원/달러 환율.
        const fbRate = effectiveFx?.usdKrw ?? 0;
        // 다른 달러 경로(표시·배분)와 같은 2자리 절사(예전엔 반올림이라 최대
        // 0.5센트 과다).
        autoUsd =
          fbRate > 0 && krwInput !== "" && krwNum > 0
            ? truncDecimals(krwNum / fbRate, 2)
            : null;
      }
      const usdOverride = usdOverrides[key];
      const usdEdited = usdOverride !== undefined && usdOverride !== "";
      const usdInput = usdEdited
        ? usdOverride
        : autoUsd !== null
          ? autoUsd.toFixed(2)
          : "";
      const effectiveUsd = usdEdited ? Number(usdOverride) : autoUsd;

      let order = null;
      if (checked && effectiveFx && pu !== null && effectiveUsd) {
        const inputs = {
          usdAmount: effectiveUsd,
          usdKrw: effectiveFx.usdKrw,
          usdBrl: effectiveFx.usdBrl,
          pu,
          bufferPct: Number(buffer) || 0,
        };
        if (isValidOrderInputs(inputs)) order = computeOrder(inputs);
      }

      // 실제 주문수량: 손대기 전엔 매수가능수량을 따라간다
      const qtyOverride = orderQtys[key];
      const orderQtyInput =
        qtyOverride !== undefined
          ? qtyOverride
          : order
            ? String(order.quantity)
            : "";
      const effectiveQty = !order
        ? 0
        : qtyOverride !== undefined && qtyOverride !== ""
          ? Math.trunc(Number(qtyOverride))
          : order.quantity;
      const orderQtyExceeds = !!order && effectiveQty > order.quantity;

      return {
        key,
        bond,
        checked,
        krwInput,
        usdInput,
        usdEdited,
        pu,
        order,
        orderQtyInput,
        effectiveQty,
        orderQtyExceeds,
      };
    });
  }, [
    bonds,
    checkedKeys,
    amounts,
    usdOverrides,
    orderQtys,
    buffer,
    effectiveFx,
    settlement,
    derivedExchange,
  ]);

  // 종목별 합계 vs 환전금액 — 원화·달러 모두 일치해야 발송 가능
  /**
   * 합계 대사는 **실제로 발송되는 줄**(`pendingLines` 조건)만 더한다.
   * 체크는 했지만 수량이 0이라 빠지는 종목까지 더하면, 화면엔 합계가
   * 맞아 발송이 될 듯하다가 서버가 받은 줄만 더해 422 로 돌려보낸다
   * (사용자에겐 원인 불명 오류). 서버와 같은 기준으로 미리 잡는다.
   */
  const sendableRows = useMemo(
    () =>
      rows.filter(
        (r) =>
          r.checked &&
          r.order &&
          r.effectiveQty >= 1 &&
          !r.orderQtyExceeds &&
          r.pu !== null &&
          r.bond.buyYieldPct !== null
      ),
    [rows]
  );
  const checkedKrwTotal = useMemo(
    () => sendableRows.reduce((s, r) => s + (Number(r.krwInput) || 0), 0),
    [sendableRows]
  );
  const checkedUsdTotal = useMemo(
    () =>
      sendableRows.reduce((s, r) => s + (parseFloat(r.usdInput || "0") || 0), 0),
    [sendableRows]
  );
  const exchangeKrwTotal = derivedExchange.krwTotal;
  const exchangeUsdTotal = derivedExchange.usdTotal;
  const anyChecked = useMemo(() => rows.some((r) => r.checked), [rows]);

  const krwMismatch =
    exchangeKrwTotal > 0 && anyChecked && checkedKrwTotal !== exchangeKrwTotal;
  // 종목별 달러($)를 직접 수정하면 합계가 환전 달러금액과 어긋날 수 있다
  const usdMismatch =
    exchangeUsdTotal > 0 &&
    anyChecked &&
    Math.abs(
      truncDecimals(checkedUsdTotal, 2) - truncDecimals(exchangeUsdTotal, 2)
    ) >= 0.005;
  // 환전금액을 아예 입력하지 않으면 원화·달러 대사를 건너뛴다 (경고만)
  const exchangeUnused =
    exchangeKrwTotal === 0 && anyChecked && checkedKrwTotal > 0;

  const pendingLines: PendingLine[] = useMemo(() => {
    return sendableRows
      .map((r) => {
        const order = r.order as NonNullable<BondRow["order"]>;
        return {
          isin: r.bond.isin ?? "",
          isinVerified: r.bond.isinVerified,
          nameKo: r.bond.nameKo,
          namePt: r.bond.namePt,
          maturityDate: r.bond.maturityDate,
          buyYieldPct: r.bond.buyYieldPct as number,
          krwAmount: Number(r.krwInput),
          usdAmount: order.usdAmount,
          pu: r.pu as number,
          quantity: order.quantity,
          orderQuantity: r.effectiveQty,
          bufferPct: Number(buffer) || 0,
        };
      });
  }, [sendableRows, buffer]);

  const incompleteCount = useMemo(
    () =>
      rows.filter(
        (r) =>
          r.checked &&
          (!r.order || r.effectiveQty < 1 || r.orderQtyExceeds)
      ).length,
    [rows]
  );

  // 탭마다 성격에 맞는 lucide 아이콘 (5번 프로젝트와 같은 방식, 오너 지시 2026-09-22)
  const TABS = [
    { key: "market" as const, label: "시장정보", icon: Newspaper },
    { key: "cashflow" as const, label: "현금흐름", icon: CalendarDays },
    { key: "simulation" as const, label: "시뮬레이션", icon: GitCompareArrows },
    // 현금흐름 기반으로 다시 만들기 전 계산을 보존한 사본. 같은 입력을 공유한다.
    { key: "duration" as const, label: "금리/환율 민감도", icon: Gauge },
    { key: "trading" as const, label: "트레이딩", icon: CandlestickChart },
  ].filter((t) => !(hideTrading && t.key === "trading"));

  return (
    <div className="print-page mx-auto grid grid-cols-1 max-w-6xl gap-5 p-4 sm:p-6">
      {hideTrading && <ClientViewGuard issued={clientIssued} viewerIp={viewerIp} />}
      {shareProblem && (
        <p
          role="alert"
          className="rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-800 dark:bg-red-950/40 dark:text-red-300"
        >
          {shareProblem}
        </p>
      )}
      <header className="flex items-center justify-between print:hidden">
        <div className="flex items-center gap-3">
          <h1 className="text-lg font-bold tracking-tight text-zinc-900 dark:text-zinc-100">
            {/* 제목 클릭 → 첫 화면(현금흐름) 탭으로 */}
            <button
              type="button"
              onClick={() => changeTab("market")}
              className="flex items-center gap-2 rounded-md outline-none hover:opacity-80 focus-visible:ring-2 focus-visible:ring-blue-500"
              aria-label="처음 화면으로"
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={BRAZIL_FLAG_DATA_URI}
                alt=""
                aria-hidden="true"
                draggable={false}
                className="flag-wave h-4 w-auto shrink-0 select-none"
              />
              브라질세상
            </button>
          </h1>
          {/* 사내한 자료 문구 — 현금흐름 탭에서 옮겨와 제목 오른쪽에 항상 표시(오너 지시) */}
          <p className="hidden text-xs font-bold text-red-600 dark:text-red-500 sm:block">
            ※ 본 자료는 참고용이며, 불특정 다수에게 제공이 금지된 사내한 자료입니다.
          </p>
        </div>
        {/* 공유 링크는 로그인/계정 메뉴 바로 왼쪽에 (오너 지시) — 고객 화면(hideTrading)·
            공유 링크로 연 화면(isSharedLink)에선 안 보인다 */}
        <div className="flex items-center gap-3">
          {!isSharedLink && !hideTrading && <ShareLinkButton value={cfInput} />}
          {/* 고객 화면엔 계정 정보를 띄우지 않는다 — 사내 직원이 링크를 열어 보거나
              캡처할 때 자기 이메일이 같이 찍힌다 */}
          {auth.enabled && auth.isSignedIn && !hideTrading && (
            <div className="flex items-center gap-2 text-xs text-zinc-500 dark:text-zinc-400">
              <span className="hidden sm:inline">{auth.email}</span>
              {/* 아바타 클릭 → 계정 관리(비밀번호 변경)·로그아웃. 관리자에겐 「승인 관리」 추가 */}
              <UserButton>
                {auth.isAdmin && (
                  <UserButton.MenuItems>
                    <UserButton.Link
                      label="승인 관리"
                      href="/admin"
                      labelIcon={
                        <svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
                          <path d="M2 8.5l3.5 3.5L14 3.5" strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                      }
                    />
                  </UserButton.MenuItems>
                )}
              </UserButton>
            </div>
          )}
          {auth.enabled && auth.isLoaded && !auth.isSignedIn && !hideTrading && (
            // 처음 오는 사람이 헤매지 않도록 트레이딩 탭 위에 로그인·가입 링크
            <div className="flex items-center gap-3 text-sm">
              <button
                type="button"
                onClick={auth.openSignIn}
                className="font-medium text-blue-600 hover:underline dark:text-blue-400"
              >
                로그인
              </button>
              <span className="text-zinc-300 dark:text-zinc-700">|</span>
              <button
                type="button"
                onClick={() => setSignupOpen(true)}
                className="text-zinc-600 hover:underline dark:text-zinc-400"
              >
                가입 신청
              </button>
            </div>
          )}
        </div>
      </header>

      <Tabs tabs={TABS} active={tab} onChange={changeTab} className="print:hidden" />

      {/*
        시장정보 패널은 탭 복원이 끝난 뒤에만 그린다. 복원 전에 그리면
        다른 탭으로 돌아갈 사람에게도 화면이 한 번 번쩍이고, 그사이 환율추이·
        Selic·국채금리·뉴스·데일리리포트·일정 요청이 헛되이 나간다
        (뉴스·리포트는 캐시가 비면 외부 수집까지 한다).
      */}
      {tab === "market" && tabRestored && (
        <>
          <FxRatePanel
            rates={fx}
            loading={fxLoading}
            error={fxError}
            onRefresh={loadFx}
          />
          <BrazilBriefing />
        </>
      )}

      {tab === "trading" && !hideTrading && !tradingUnlocked && (
        <TradingGate onSignup={() => setSignupOpen(true)} />
      )}

      {tab === "trading" && !hideTrading && tradingUnlocked && (
        <>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 rounded-xl border border-zinc-200/80 bg-white px-3.5 py-2.5 text-xs shadow-sm dark:border-zinc-800 dark:bg-zinc-950 dark:shadow-none">
            <span className="font-semibold tracking-tight text-zinc-700 dark:text-zinc-200">
              환율
            </span>
            {/*
              표·서버 대조와 같은 값(effectiveFx)을 보인다 — 고시환율을 고치면
              계산은 수정값을 쓰는데 여기만 API 원본을 보여줘 기준이 엇갈렸다
              (오너 지시 2026-09-22 · 점검 L7). 수정한 상태면 원본값을 괄호로 같이 적는다.
            */}
            {effectiveFx ? (
              <>
                <span className="tabular-nums text-zinc-600 dark:text-zinc-300">
                  원/달러{" "}
                  <span className="font-medium text-zinc-900 dark:text-zinc-100">
                    ₩{effectiveFx.usdKrw.toLocaleString("ko-KR", {
                      maximumFractionDigits: 2,
                    })}
                  </span>
                  {fx && effectiveFx.usdKrw !== fx.usdKrw && (
                    <span className="text-zinc-400">
                      {" "}
                      (수정 · 고시 ₩
                      {fx.usdKrw.toLocaleString("ko-KR", {
                        maximumFractionDigits: 2,
                      })}
                      )
                    </span>
                  )}
                </span>
                <span className="tabular-nums text-zinc-600 dark:text-zinc-300">
                  원/헤알{" "}
                  <span className="font-medium text-zinc-900 dark:text-zinc-100">
                    ₩{effectiveFx.krwBrl.toLocaleString("ko-KR", {
                      maximumFractionDigits: 2,
                    })}
                  </span>
                </span>
                <span className="tabular-nums text-zinc-600 dark:text-zinc-300">
                  달러/헤알{" "}
                  <span className="font-medium text-zinc-900 dark:text-zinc-100">
                    R${effectiveFx.usdBrl.toLocaleString("ko-KR", {
                      maximumFractionDigits: 4,
                    })}
                  </span>
                </span>
              </>
            ) : (
              <span className="text-zinc-400">{fxError ?? "불러오는 중…"}</span>
            )}
            <Button
              size="sm"
              variant="secondary"
              onClick={loadFx}
              disabled={fxLoading}
              className="ml-auto"
            >
              {fxLoading ? "조회 중…" : "새로고침"}
            </Button>
          </div>

          <CurrencyExchange
            usdKrw={fx?.usdKrw ?? null}
            value={exchange}
            onChange={setExchange}
          />

          <p className="text-xs text-zinc-500 dark:text-zinc-400">
            주문일 {orderDate} · 결제일 {settlementDate} (D+1 브라질 영업일)
          </p>

          <BondOrderTable
            rows={rows}
            asOfDate={asOfDate}
            quote={quote}
            loading={bondLoading}
            error={bondError}
            fxReady={!!fx}
            settlementDate={settlementDate}
            exchangeKrwTotal={exchangeKrwTotal}
            exchangeUsdTotal={exchangeUsdTotal}
            buffer={buffer}
            onBufferChange={setBuffer}
            onToggle={toggle}
            onAmountChange={changeAmount}
            onUsdChange={changeUsd}
            onOrderQtyChange={changeOrderQty}
          />

          <OrderReview
            lines={pendingLines}
            incompleteCount={incompleteCount}
            fx={effectiveFx}
            defaultTo={defaultTo}
            defaultCc={defaultCc}
            exchangeTotals={{ krwTotal: exchangeKrwTotal, usdTotal: exchangeUsdTotal }}
            allowedDomains={allowedDomains}
            quote={quote}
            settlementDate={settlementDate}
            krwMismatch={krwMismatch}
            krwMismatchDetail={
              krwMismatch
                ? { rows: checkedKrwTotal, exchange: exchangeKrwTotal }
                : null
            }
            usdMismatch={usdMismatch}
            usdMismatchDetail={
              usdMismatch
                ? {
                    rows: truncDecimals(checkedUsdTotal, 2),
                    exchange: truncDecimals(exchangeUsdTotal, 2),
                  }
                : null
            }
            exchangeUnused={exchangeUnused}
          />

          <footer className="pb-8 text-[11px] text-zinc-400">
            환율은 Frankfurter(ECB) 중간환율이며 실제 체결 환율·스프레드와
            다릅니다. 시세는 레포에 커밋된 주간 스냅샷 기준입니다. 발송 전 반드시
            값을 확인하세요.
          </footer>
        </>
      )}

      {tab === "cashflow" && (
        <CashFlowPanel
          value={cfInput}
          onChange={setCfInput}
          locked={cfLocked}
          onLockedChange={setCfLocked}
          isSharedLink={isSharedLink}
        />
      )}

      {tab === "simulation" && (
        <TrustStrategyPanel
          bonds={bonds}
          fx={fx}
          state={simState}
          onChange={setSimState}
        />
      )}

      {tab === "duration" && (
        <DurationPanel bonds={bonds} fx={fx} state={durState} onChange={setDurState} />
      )}

      <SignupDialog
        open={signupOpen}
        onClose={() => setSignupOpen(false)}
        allowedDomains={allowedDomains}
      />
    </div>
  );
}
