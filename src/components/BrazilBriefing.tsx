"use client";

import { useEffect, useState } from "react";

interface NewsItem {
  titleKo: string;
  titlePt: string;
  link: string;
  category: string;
  publishedAt: string;
  source: string;
}

interface AgendaItem {
  date: string;
  titleKo: string;
  category: "경제지표" | "휴장";
  guidance: string | null;
  actual: string | null;
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

/**
 * 환율 패널과 종목 표 사이에 놓이는 브라질 브리핑.
 * 상단: 현지 뉴스 5건(한글 번역·원문 링크). 하단: 향후 약 1개월 주요일정.
 */
export function BrazilBriefing() {
  const [news, setNews] = useState<NewsItem[] | null>(null);
  const [newsError, setNewsError] = useState(false);
  const [agenda, setAgenda] = useState<AgendaItem[] | null>(null);

  useEffect(() => {
    let cancelled = false;

    fetch("/api/br-news")
      .then((r) => r.json())
      .then((d) => {
        if (cancelled) return;
        if (Array.isArray(d.items) && d.items.length) setNews(d.items);
        else setNewsError(true);
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
    <section className="grid gap-4 rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-950 sm:grid-cols-2">
      {/* 뉴스 */}
      <div>
        <h2 className="mb-2 text-sm font-semibold text-zinc-900 dark:text-zinc-100">
          브라질 현지 뉴스{" "}
          <span className="text-[11px] font-normal text-zinc-400">
            (Google 뉴스 · 자동 번역)
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
        {news && (
          <p className="mb-2 text-[11px] text-zinc-400">
            자동 수집·번역이라 부정확할 수 있습니다. 원문 링크로 확인하세요.
          </p>
        )}
        <ul className="space-y-2">
          {news?.map((n) => (
            <li key={n.link} className="text-xs">
              <a
                href={n.link}
                target="_blank"
                rel="noopener noreferrer"
                className="font-medium text-zinc-800 hover:text-blue-600 hover:underline dark:text-zinc-100 dark:hover:text-blue-400"
              >
                {n.titleKo}
              </a>
              <p className="mt-0.5 text-[11px] text-zinc-400">
                <span className="rounded bg-zinc-100 px-1 dark:bg-zinc-800">
                  {n.category}
                </span>{" "}
                {n.source} · {relTime(n.publishedAt)}
              </p>
              <p className="text-[11px] italic text-zinc-400">{n.titlePt}</p>
            </li>
          ))}
        </ul>
      </div>

      {/* 주요일정 */}
      <div>
        <h2 className="mb-2 text-sm font-semibold text-zinc-900 dark:text-zinc-100">
          브라질 주요일정{" "}
          <span className="text-[11px] font-normal text-zinc-400">
            (전후 15일 · 예상/발표)
          </span>
        </h2>
        {!agenda && (
          <p className="text-xs text-zinc-500 dark:text-zinc-400">
            불러오는 중…
          </p>
        )}
        {agenda && agenda.length === 0 && (
          <p className="text-xs text-zinc-500 dark:text-zinc-400">
            해당 기간 주요일정이 없습니다.
          </p>
        )}
        <ul className="space-y-1.5">
          {agenda?.map((a, i) => {
            const past = a.date < new Date().toISOString().slice(0, 10);
            return (
              <li
                key={`${a.date}-${i}`}
                className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 text-xs"
              >
                <span
                  className={`w-16 shrink-0 tabular-nums ${
                    past
                      ? "text-zinc-400 dark:text-zinc-500"
                      : "font-medium text-zinc-600 dark:text-zinc-300"
                  }`}
                >
                  {fmtDate(a.date)}
                </span>
                <span
                  className={`shrink-0 rounded px-1 text-[10px] ${
                    a.category === "휴장"
                      ? "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300"
                      : "bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400"
                  }`}
                >
                  {a.category}
                </span>
                <span className="text-zinc-800 dark:text-zinc-100">
                  {a.titleKo}
                </span>
                {(a.guidance || a.actual) && (
                  <span className="tabular-nums text-[11px] text-zinc-500 dark:text-zinc-400">
                    {a.guidance && <>예상 {a.guidance}</>}
                    {a.guidance && a.actual && " → "}
                    {a.actual && (
                      <span className="font-semibold text-blue-700 dark:text-blue-300">
                        발표 {a.actual}
                      </span>
                    )}
                  </span>
                )}
              </li>
            );
          })}
        </ul>
      </div>
    </section>
  );
}
