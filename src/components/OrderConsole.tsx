"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { FxRatePanel } from "@/components/FxRatePanel";
import { Tabs } from "@/components/ui/Tabs";
import { Button } from "@/components/ui/Button";
import {
  CurrencyExchange,
  deriveExchange,
  EMPTY_EXCHANGE,
  type ExchangeState,
} from "@/components/CurrencyExchange";
import { SimulationPanel } from "@/components/SimulationPanel";
import { createSimulationState } from "@/components/RollSwitchComparison";
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
import type { BondItem, BondSearchResponse, FxRates } from "@/lib/types";

interface OrderConsoleProps {
  /** 서버가 해석한 공유 링크. 링크가 아니면 null. */
  share: ShareResolution | null;
  /** 트레이딩 탭 가입·사용이 허용되는 회사 이메일 도메인 */
  allowedDomains: string[];
  /** `/?signup=1` — 가입 신청 폼을 바로 연다 */
  openSignup?: boolean;
}

export function OrderConsole({ share, allowedDomains, openSignup = false }: OrderConsoleProps) {
  // 트레이딩 탭·주문 발송은 승인된 회사 계정만 (감사 ⑤ 치명1). 서버 API 도 같은 기준.
  const auth = useAppAuth();
  const tradingUnlocked = auth.enabled && auth.isSignedIn && auth.allowed === true;

  const [fx, setFx] = useState<FxRates | null>(null);
  const [fxLoading, setFxLoading] = useState(true);
  const [fxError, setFxError] = useState<string | null>(null);

  const [bonds, setBonds] = useState<BondItem[]>([]);
  const [asOfDate, setAsOfDate] = useState<string | null>(null);
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
  const [tab, setTab] = useState<
    "market" | "trading" | "cashflow" | "simulation" | "duration"
  >(() => (hideTrading ? "cashflow" : "market"));

  // 현금흐름 입력값·잠금 — 여기서 보유해 탭을 옮겨도 유지되고(감사 ⑤ 중7),
  // 탭 줄의 공유 링크 버튼이 같은 값을 쓴다.
  const isSharedLink = shareInput !== null;
  const [cfInput, setCfInput] = useState<BondLayoutInput>(() =>
    shareInput ? { ...createDefaultInput(), ...shareInput } : createDefaultInput()
  );
  const [cfLocked, setCfLocked] = useState<boolean>(isSharedLink);
  // 시뮬레이션·민감도 입력값도 여기서 보유 — 탭을 옮겨도 유지(감사 ⑤ 중7)
  const [simState, setSimState] = useState(createSimulationState);
  const [durState, setDurState] = useState(createDurationState);
  // 가입 신청 팝업 (헤더 링크·트레이딩 안내·/?signup=1 에서 연다)
  const [signupOpen, setSignupOpen] = useState(openSignup);
  // 트레이딩 탭을 눌렀는데 로그인 전이면 로그인 팝업을 바로 띄운다
  const changeTab = (k: typeof tab) => {
    setTab(k);
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
  const checkedKrwTotal = useMemo(
    () =>
      rows.reduce((s, r) => s + (r.checked ? Number(r.krwInput) || 0 : 0), 0),
    [rows]
  );
  const checkedUsdTotal = useMemo(
    () =>
      rows.reduce(
        (s, r) => s + (r.checked ? parseFloat(r.usdInput || "0") || 0 : 0),
        0
      ),
    [rows]
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
    return rows
      .filter(
        (r) =>
          r.checked &&
          r.order &&
          r.effectiveQty >= 1 &&
          !r.orderQtyExceeds &&
          r.pu !== null &&
          r.bond.buyYieldPct !== null
      )
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
  }, [rows, buffer]);

  const incompleteCount = useMemo(
    () =>
      rows.filter(
        (r) =>
          r.checked &&
          (!r.order || r.effectiveQty < 1 || r.orderQtyExceeds)
      ).length,
    [rows]
  );

  const TABS = [
    { key: "market" as const, label: "시장정보" },
    { key: "cashflow" as const, label: "현금흐름" },
    { key: "simulation" as const, label: "시뮬레이션" },
    { key: "duration" as const, label: "금리/환율 민감도" },
    { key: "trading" as const, label: "트레이딩" },
  ].filter((t) => !(hideTrading && t.key === "trading"));

  return (
    <div className="print-page mx-auto grid max-w-6xl gap-5 p-4 sm:p-6">
      {hideTrading && <ClientViewGuard issued={clientIssued} />}
      {shareProblem && (
        <p
          role="alert"
          className="rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-800 dark:bg-red-950/40 dark:text-red-300"
        >
          {shareProblem}
        </p>
      )}
      <header className="flex items-center justify-between print:hidden">
        <h1 className="text-lg font-bold tracking-tight text-zinc-900 dark:text-zinc-100">
          {/* 제목 클릭 → 시장정보(첫 화면) 탭으로. 고객 화면(트레이딩 숨김)에선 현금흐름으로 */}
          <button
            type="button"
            onClick={() => setTab(hideTrading ? "cashflow" : "market")}
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
        {auth.enabled && auth.isSignedIn && (
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
      </header>

      <Tabs
        tabs={TABS}
        active={tab}
        onChange={changeTab}
        className="print:hidden"
        // 공유 링크 생성은 트레이딩 탭과 같은 줄의 독립 버튼. 고객 화면에선 없음.
        trailing={!isSharedLink && !hideTrading ? <ShareLinkButton value={cfInput} /> : null}
      />

      {tab === "market" && (
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
            {fx ? (
              <>
                <span className="tabular-nums text-zinc-600 dark:text-zinc-300">
                  원/달러{" "}
                  <span className="font-medium text-zinc-900 dark:text-zinc-100">
                    ₩{fx.usdKrw.toLocaleString("ko-KR", {
                      maximumFractionDigits: 2,
                    })}
                  </span>
                </span>
                <span className="tabular-nums text-zinc-600 dark:text-zinc-300">
                  원/헤알{" "}
                  <span className="font-medium text-zinc-900 dark:text-zinc-100">
                    ₩{fx.krwBrl.toLocaleString("ko-KR", {
                      maximumFractionDigits: 2,
                    })}
                  </span>
                </span>
                <span className="tabular-nums text-zinc-600 dark:text-zinc-300">
                  달러/헤알{" "}
                  <span className="font-medium text-zinc-900 dark:text-zinc-100">
                    R${fx.usdBrl.toLocaleString("ko-KR", {
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
        <SimulationPanel bonds={bonds} fx={fx} state={simState} onChange={setSimState} />
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
