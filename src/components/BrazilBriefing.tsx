"use client";

import { useEffect, useState } from "react";

interface NewsItem {
  titleKo: string;
  titlePt: string;
  translationOk: boolean;
  link: string;
  category: string;
  publishedAt: string;
  source: string;
}

interface LocalNewsItem {
  title: string;
  link: string;
  summary: string;
  publishedAt: string;
  source: string;
}

interface BriefTopic {
  headline: string;
  bullets: string[];
  notes: string[];
}

interface DailyReport {
  title: string;
  publishedAt: string;
  link: string;
  sourceName: string;
  sourceUrl: string;
  brief: BriefTopic[];
  partial: boolean;
}

interface AgendaItem {
  date: string;
  titleKo: string;
  category: "경제지표" | "휴장" | "선거";
  released: boolean;
  guidance: string | null;
  actual: string | null;
  prior: string | null;
}

function relTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const h = Math.floor(diff / 3_600_000);
  if (h < 1) return "방금";
  if (h < 24) return `${h}시간 전`;
  return `${Math.floor(h / 24)}일 전`;
}

function fmtDate(iso: string): string {
  const d = new Date(iso);
  const wd = ["일", "월", "화", "수", "목", "금", "토"][d.getUTCDay()];
  return `${d.getUTCMonth() + 1}/${d.getUTCDate()}(${wd})`;
}

function LocalNewsList({ items }: { items: LocalNewsItem[] }) {
  return (
    <ul className="space-y-2.5">
      {items.map((n) => (
        <li key={n.link} className="text-xs">
          <a
            href={n.link}
            target="_blank"
            rel="noopener noreferrer"
            className="font-medium text-zinc-800 hover:text-blue-600 hover:underline dark:text-zinc-100 dark:hover:text-blue-400"
          >
            {n.title}
          </a>
          {n.summary && (
            <p className="mt-0.5 line-clamp-1 text-[11px] text-zinc-500 dark:text-zinc-400">
              {n.summary}
            </p>
          )}
          <p className="mt-0.5 text-[11px] text-zinc-400">
            {n.source} · {relTime(n.publishedAt)}
          </p>
        </li>
      ))}
    </ul>
  );
}

function NewsList({ items }: { items: NewsItem[] }) {
  return (
    <ul className="space-y-2">
      {items.map((n) => (
        <li key={n.link} className="text-xs">
          <a
            href={n.link}
            target="_blank"
            rel="noopener noreferrer"
            className="font-medium text-zinc-800 hover:text-blue-600 hover:underline dark:text-zinc-100 dark:hover:text-blue-400"
          >
            {n.titleKo}
          </a>
          {!n.translationOk && (
            <span className="ml-1 rounded bg-amber-100 px-1 text-[10px] text-amber-700 dark:bg-amber-900/40 dark:text-amber-300">
              번역 불확실
            </span>
          )}
          <p className="mt-0.5 text-[11px] text-zinc-400">
            <span className="rounded bg-zinc-100 px-1 dark:bg-zinc-800">
              {n.category}
            </span>{" "}
            {n.source} · {relTime(n.publishedAt)}
          </p>
        </li>
      ))}
    </ul>
  );
}

function DailyReportCard({ report }: { report: DailyReport }) {
  return (
    <section className="rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-950">
      <div className="mb-2 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
          {report.title}
        </h2>
        <span className="text-[11px] text-zinc-400">
          {relTime(report.publishedAt)}
        </span>
      </div>

      {report.brief.length > 0 && (
        <div className="space-y-3">
          {report.brief.map((t, i) => (
            <div key={i}>
              {t.headline && (
                <p className="text-xs font-semibold text-zinc-800 dark:text-zinc-100">
                  {t.headline}
                </p>
              )}
              <ul className="mt-1 space-y-1">
                {t.bullets.map((b, j) => (
                  <li
                    key={j}
                    className="flex gap-1.5 text-xs text-zinc-600 dark:text-zinc-300"
                  >
                    <span className="text-zinc-400">•</span>
                    <span>{b}</span>
                  </li>
                ))}
              </ul>
              {t.notes.map((n, j) => (
                <p
                  key={j}
                  className="mt-1 text-[11px] italic text-zinc-400 dark:text-zinc-500"
                >
                  {n}
                </p>
              ))}
            </div>
          ))}
        </div>
      )}

      <p className="mt-3 border-t border-zinc-100 pt-2 text-[11px] text-zinc-400 dark:border-zinc-800">
        {report.partial && "본문 요약만 표시됩니다. "}
        출처{" "}
        <a
          href={report.sourceUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="hover:text-blue-600 hover:underline dark:hover:text-blue-400"
        >
          {report.sourceName}
        </a>{" "}
        ·{" "}
        <a
          href={report.link}
          target="_blank"
          rel="noopener noreferrer"
          className="hover:text-blue-600 hover:underline dark:hover:text-blue-400"
        >
          원문 보기 →
        </a>
      </p>
    </section>
  );
}

function AgendaRow({ a }: { a: AgendaItem }) {
  const past = a.date < new Date().toISOString().slice(0, 10);
  const badge =
    a.category === "선거"
      ? "bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-300"
      : a.category === "휴장"
        ? "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300"
        : "bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400";
  return (
    <li className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 text-xs">
      <span
        className={`w-16 shrink-0 tabular-nums ${
          past
            ? "text-zinc-400 dark:text-zinc-500"
            : "font-medium text-zinc-600 dark:text-zinc-300"
        }`}
      >
        {fmtDate(a.date)}
      </span>
      <span className={`shrink-0 rounded px-1 text-[10px] ${badge}`}>
        {a.category}
      </span>
      <span className="text-zinc-800 dark:text-zinc-100">{a.titleKo}</span>
      {a.category === "경제지표" && (
        <span className="tabular-nums text-[11px] text-zinc-500 dark:text-zinc-400">
          예상 {a.guidance ?? "—"}
          {" · "}
          {a.released ? (
            <span className="font-semibold text-blue-700 dark:text-blue-300">
              발표 {a.actual ?? "—"}
            </span>
          ) : (
            <span>이전 {a.prior ?? "—"}</span>
          )}
        </span>
      )}
    </li>
  );
}

/** 두 날짜를 "8월 15일~30일" / "8월 30일~10월 30일" 형태로 */
function fmtRange(start: Date, end: Date): string {
  const sm = start.getMonth() + 1;
  const em = end.getMonth() + 1;
  return sm === em
    ? `${sm}월 ${start.getDate()}일~${end.getDate()}일`
    : `${sm}월 ${start.getDate()}일~${em}월 ${end.getDate()}일`;
}

function AgendaColumn({
  title,
  note,
  items,
}: {
  title: string;
  note: string;
  items: AgendaItem[];
}) {
  return (
    <div>
      <h3 className="mb-1 text-[11px] font-semibold text-zinc-500 dark:text-zinc-400">
        {title}{" "}
        <span className="font-normal text-zinc-400">({note})</span>
      </h3>
      {items.length === 0 ? (
        <p className="text-xs text-zinc-400">없음</p>
      ) : (
        <ul className="space-y-1.5">
          {items.map((a, i) => (
            <AgendaRow key={`${a.date}-${a.titleKo}-${i}`} a={a} />
          ))}
        </ul>
      )}
    </div>
  );
}

/**
 * 대선(선거)은 전체폭으로 강조 유지, 나머지(경제지표·휴장)는
 * 좌: 이전일정 / 우: 예정일정.
 */
function AgendaBody({ agenda }: { agenda: AgendaItem[] | null }) {
  if (!agenda) {
    return (
      <p className="text-xs text-zinc-500 dark:text-zinc-400">불러오는 중…</p>
    );
  }
  if (agenda.length === 0) {
    return (
      <p className="text-xs text-zinc-500 dark:text-zinc-400">
        해당 기간 주요일정이 없습니다.
      </p>
    );
  }
  const now = new Date();
  const today = now.toISOString().slice(0, 10);
  const elections = agenda.filter((a) => a.category === "선거");
  const rest = agenda.filter((a) => a.category !== "선거");
  const past = rest.filter((a) => a.date < today);
  const upcoming = rest.filter((a) => a.date >= today);

  // br-agenda 라우트의 조회 범위(과거 15일 · 향후 60일)와 맞춘 대상기간 주석
  const back = new Date(now);
  back.setDate(back.getDate() - 15);
  const fwd = new Date(now);
  fwd.setDate(fwd.getDate() + 60);

  return (
    <>
      {elections.length > 0 && (
        <ul className="mb-3 space-y-1.5 border-b border-zinc-100 pb-2 dark:border-zinc-800">
          {elections.map((a, i) => (
            <AgendaRow key={`e-${i}`} a={a} />
          ))}
        </ul>
      )}
      <div className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
        <AgendaColumn
          title="이전일정"
          note={fmtRange(back, now)}
          items={past}
        />
        <AgendaColumn
          title="예정일정"
          note={fmtRange(now, fwd)}
          items={upcoming}
        />
      </div>
    </>
  );
}

/**
 * 환율 패널과 종목 표 사이에 놓이는 브라질 브리핑.
 * ① KOBRAS 데일리 리포트 → ② 뉴스(좌: 현지 · 우: 글로벌) → ③ 주요일정.
 */
export function BrazilBriefing() {
  const [news, setNews] = useState<LocalNewsItem[] | null>(null);
  const [global, setGlobal] = useState<NewsItem[] | null>(null);
  const [newsError, setNewsError] = useState(false);
  const [report, setReport] = useState<DailyReport | null>(null);
  const [agenda, setAgenda] = useState<AgendaItem[] | null>(null);

  useEffect(() => {
    let cancelled = false;

    fetch("/api/br-daily-report")
      .then((r) => r.json())
      .then((d) => {
        if (!cancelled && d.report) setReport(d.report as DailyReport);
      })
      .catch(() => {});

    fetch("/api/br-news")
      .then((r) => r.json())
      .then((d) => {
        if (cancelled) return;
        if (Array.isArray(d.items) && d.items.length) setNews(d.items);
        else setNewsError(true);
        if (Array.isArray(d.global)) setGlobal(d.global);
      })
      .catch(() => !cancelled && setNewsError(true));

    fetch("/api/br-agenda")
      .then((r) => r.json())
      .then((d) => {
        if (!cancelled && Array.isArray(d.items)) setAgenda(d.items);
      })
      .catch(() => {});

    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="grid gap-4">
      {report && <DailyReportCard report={report} />}

      {/* 뉴스: 좌 = 현지, 우 = 글로벌 */}
      <section className="grid gap-4 rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-950 sm:grid-cols-2">
        <div>
          <h2 className="mb-2 text-sm font-semibold text-zinc-900 dark:text-zinc-100">
            브라질 현지 뉴스{" "}
            <span className="text-[11px] font-normal text-zinc-400">
              (좋은아침뉴스 · 상파울루 한인신문)
            </span>
          </h2>
          {!news && !newsError && (
            <p className="text-xs text-zinc-500 dark:text-zinc-400">
              불러오는 중…
            </p>
          )}
          {newsError && (
            <p className="text-xs text-red-500">뉴스를 불러오지 못했습니다.</p>
          )}
          {news && <LocalNewsList items={news} />}
        </div>

        <div>
          <h2 className="mb-2 text-sm font-semibold text-zinc-900 dark:text-zinc-100">
            브라질 관련 글로벌 뉴스{" "}
            <span className="text-[11px] font-normal text-zinc-400">
              (영문 · 자동 번역)
            </span>
          </h2>
          {!global && (
            <p className="text-xs text-zinc-500 dark:text-zinc-400">
              불러오는 중…
            </p>
          )}
          {global && global.length === 0 && (
            <p className="text-xs text-zinc-500 dark:text-zinc-400">
              글로벌 뉴스가 없습니다.
            </p>
          )}
          {global && global.length > 0 && <NewsList items={global} />}
        </div>
      </section>

      {/* 주요일정: 뉴스 아래 */}
      <section className="rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-950">
        <h2 className="mb-2 text-sm font-semibold text-zinc-900 dark:text-zinc-100">
          브라질 주요일정
        </h2>
        <AgendaBody agenda={agenda} />
        {agenda && agenda.length > 0 && (
          <p className="mt-3 border-t border-zinc-100 pt-2 text-[11px] text-zinc-400 dark:border-zinc-800">
            출처 발표일 IBGE 캘린더 · 예상치 브라질 중앙은행 Focus 설문 · 발표치
            브라질 중앙은행 SGS · 휴장일 B3 · 대선 일정 TSE
          </p>
        )}
      </section>
    </div>
  );
}
