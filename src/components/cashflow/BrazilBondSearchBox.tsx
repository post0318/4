"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { BondLayoutInput, CalcBasis, Currency, TaxStatus } from "@/lib/cashflow/bondLayout";

interface BrazilBondItem {
  maturityDate: string;
  buyRate: number | null;
  sellRate: number | null;
  buyPrice: number | null;
  sellPrice: number | null;
}

/** NTN-F는 2015년 이후 표면이율 연 10.00% 단일금리로 통일 발행된다 */
const NTNF_COUPON_RATE = "10";

interface BrazilBondSearchBoxProps {
  disabled: boolean;
  onApply: (fields: Partial<BondLayoutInput>) => void;
}

/**
 * NTN-F(Nota do Tesouro Nacional Série F, 소매판매명 "Tesouro Prefixado com
 * Juros Semestrais") 현재 거래 종목을 골라 선택 즉시 발행일/만기일/표면이율/
 * 지급주기/날짜계산기준/거래통화를 자동 반영한다. NTN-F는 표면이율 연 10.00%
 * 고정, 6개월마다(1/1, 7/1) 이자 지급, 일수계산은 브라질 영업일 기준
 * Business/252를 쓴다(brazilCalendar.ts).
 *
 * 목록 데이터는 /api/br-bond-search 가 레포에 커밋된 스냅샷
 * (src/lib/server/ntnf-snapshot.json)을 그대로 반환한다. 원본은
 * tesourotransparente.gov.br의 14MB CSV뿐인데(옛 JSON API는 410 Gone, B3
 * API는 봇차단) 요청 시점에 받으면 40초가 걸려, GitHub Actions가 주간으로
 * 스냅샷을 갱신 커밋 → 재배포하는 방식으로 바꿨다(scripts/fetch-ntnf-snapshot.mjs).
 *
 * 신용등급은 개별 채권이 아니라 tradingeconomics.com의 브라질 국가신용등급
 * (S&P/Moody's)을 가져와 반영한다(한국채권검색의 국고채권, 미국채권검색의
 * U.S. Treasury와 동일한 취급). 발행일은 데이터에 없어, NTN-F가 만기 11년 전
 * 1월 1일에 발행되는 관행(maisretorno.com 실제 발행일·Bloomberg 데이터로
 * 확인)을 근거로 추정해 반영한다(확인 후 사용 권장). 과세여부 기본값은
 * "비과세"로 반영한다.
 */
export function BrazilBondSearchBox({ disabled, onApply }: BrazilBondSearchBoxProps) {
  const [open, setOpen] = useState(false);
  const [bonds, setBonds] = useState<BrazilBondItem[] | null>(null);
  const [asOfDate, setAsOfDate] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const containerRef = useRef<HTMLDivElement>(null);

  const filteredBonds = useMemo(() => {
    if (!bonds) return [];
    const keyword = query.trim().toLowerCase();
    if (!keyword) return bonds;
    return bonds.filter((b) =>
      `${b.maturityDate} ${b.buyRate ?? ""} ${b.sellRate ?? ""}`
        .toLowerCase()
        .includes(keyword)
    );
  }, [bonds, query]);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const toggleOpen = () => {
    setOpen((v) => !v);
    if (!open && bonds === null && !loading) {
      setLoading(true);
      setError(null);
      fetch("/api/cashflow/br-bond-search")
        .then((res) => res.json())
        .then((data: { asOfDate?: string; bonds?: BrazilBondItem[] }) => {
          const today = new Date().toISOString().slice(0, 10);
          const all = Array.isArray(data.bonds) ? data.bonds : [];
          setAsOfDate(data.asOfDate ?? null);
          setBonds(all.filter((b) => b.maturityDate >= today));
        })
        .catch(() => setError("조회 중 오류가 발생했습니다."))
        .finally(() => setLoading(false));
    }
  };

  const selectBond = (bond: BrazilBondItem) => {
    const year = Number(bond.maturityDate.slice(0, 4));
    // NTN-F는 만기 11년 전 1월 1일에 발행되는 관행이 있다(2027→2016, 2029→2018, ...
    // 2037→2026년 발행 - maisretorno.com 실제 발행일 및 Bloomberg 기준 확인).
    const issueDate = `${year - 11}-01-01`;
    const fields: Partial<BondLayoutInput> = {
      name: `NTN-F ${NTNF_COUPON_RATE}% ${bond.maturityDate}`,
      issueDate,
      maturityDate: bond.maturityDate,
      couponRate: NTNF_COUPON_RATE,
      couponFrequency: "6개월",
      calcBasis: "Business/252" as CalcBasis,
      tradeCurrency: "BRL" as Currency,
      custodyCurrency: "KRW" as Currency,
      creditRating: "RF",
      taxStatus: "비과세" as TaxStatus,
    };
    // 매수금리: sellRate(Taxa Venda, 테조우로가 투자자에게 파는 쪽=투자자
    // 매수 기준 금리)를 반영한다. buyRate(Taxa Compra)는 투자자가 되파는
    // (매도) 쪽 금리라 매수 단가 계산에는 맞지 않는다. 값이 없으면 이전에
    // 선택한 종목의 매수금리가 남지 않도록 0으로 되돌린다.
    fields.purchaseYield =
      typeof bond.sellRate === "number" ? String(bond.sellRate) : "0";

    onApply(fields);
    setOpen(false);

    fetch("/api/cashflow/country-rating?slug=brazil")
      .then((res) => res.json())
      .then((data: { rating?: string | null }) => {
        if (data.rating) onApply({ creditRating: data.rating });
      })
      .catch(() => {});

    // 거래통화(BRL)와 수탁통화(KRW)가 달라 환율을 직접 입력해야 하는데,
    // ECB 기준 무료 공개 API(Frankfurter.dev)로 현재 환율을 조회해 매수/만기
    // 환율의 기본값으로 채워 넣는다(investing.com은 봇 차단으로 서버에서
    // 조회 불가). 사용자가 필요하면 직접 수정할 수 있다.
    fetch("/api/cashflow/fx-rate?base=BRL&quote=KRW")
      .then((res) => res.json())
      .then((data: { rate?: number | null }) => {
        if (typeof data.rate === "number") {
          const rate = String(data.rate);
          onApply({ purchaseFxRate: rate, maturityFxRate: rate });
        }
      })
      .catch(() => {});
  };

  return (
    <div className="relative inline-flex items-center gap-2" ref={containerRef}>
      <button
        type="button"
        disabled={disabled}
        onClick={toggleOpen}
        className="text-sm font-medium text-blue-600 underline-offset-2 hover:underline disabled:cursor-not-allowed disabled:text-zinc-400 dark:text-blue-400 dark:disabled:text-zinc-600"
      >
        브라질채권검색
      </button>

      {open && (
        <div className="absolute left-0 top-full z-20 mt-1 w-96 rounded-lg border border-zinc-200 bg-white p-3 shadow-lg dark:border-zinc-700 dark:bg-zinc-900">
          <p className="mb-2 text-xs text-zinc-500 dark:text-zinc-400">
            NTN-F (Tesouro Prefixado com Juros Semestrais)
            {asOfDate && ` · 기준일 ${asOfDate}`}
          </p>

          {bonds && bonds.length > 0 && (
            <input
              autoFocus
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="만기/금리로 좁히기 (예: 2033 또는 14.7)"
              className="mb-2 w-full rounded-md border border-zinc-300 px-2 py-1.5 text-sm outline-none focus:border-blue-400 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100"
            />
          )}

          {error && <p className="text-xs text-zinc-500 dark:text-zinc-400">{error}</p>}
          {loading && <p className="text-xs text-zinc-500 dark:text-zinc-400">조회 중...</p>}

          {!loading && !error && bonds && (
            <ul className="max-h-56 overflow-y-auto">
              {filteredBonds.map((b) => (
                <li key={b.maturityDate}>
                  <button
                    type="button"
                    onClick={() => selectBond(b)}
                    className="block w-full rounded px-2 py-1 text-left text-sm hover:bg-zinc-100 dark:hover:bg-zinc-800"
                  >
                    <span className="block">
                      NTN-F {NTNF_COUPON_RATE}% {b.maturityDate}
                    </span>
                    <span className="text-xs text-zinc-400">
                      {b.buyRate !== null ? `매수 ${b.buyRate}%` : ""}
                      {b.sellRate !== null ? ` · 매도 ${b.sellRate}%` : ""}
                    </span>
                  </button>
                </li>
              ))}
              {filteredBonds.length === 0 && (
                <li className="px-2 py-1 text-xs text-zinc-400">거래 중인 종목이 없습니다.</li>
              )}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
