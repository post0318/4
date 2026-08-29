import { brazilHolidayList } from "@/lib/brazilCalendar";
import { inRange } from "@/lib/server/sanity";

/**
 * 브라질 주요일정 — 조회일 기준 전후 15일의 "중요한" 경제지표 발표와 시장 휴장일.
 *
 * - 발표일: IBGE 공식 캘린더 API (무인증)
 * - 가이던스(시장 예상): 브라질 중앙은행 Focus 설문 (Expectativas OData, 무인증)
 * - 발표치(실제): 브라질 중앙은행 SGS 시계열 (무인증). 발표일이 지난 항목만.
 */

export interface AgendaItem {
  /** ISO 날짜 */
  date: string;
  titleKo: string;
  category: "경제지표" | "휴장";
  /** 발표일이 지났는지 */
  released: boolean;
  /** 시장 예상치 (Focus 중앙값). 없으면 null */
  guidance: string | null;
  /** 발표된 실제치 (released=true 일 때). 없으면 null */
  actual: string | null;
  /** 직전 발표치 (released=false 일 때 참고용). 없으면 null */
  prior: string | null;
}

type FocusKind = "month" | "quarter";

interface Curated {
  labelKo: string;
  unit: string;
  /** 발표월 → 참조월 오프셋 (IPCA는 전월분 발표: -1) */
  refOffset: number;
  /** 발표치 SGS 시리즈 코드 */
  sgs: number | null;
  /** Focus 예상치 설정 */
  focus: { indicador: string; kind: FocusKind } | null;
  /** 이 지표 값의 상식 범위 (검증). 벗어나면 값을 버린다 */
  bounds: readonly [number, number];
}

// 순서대로 첫 매칭 사용. null 이면 "중요하지 않음"으로 제외.
const CURATED: [RegExp, Curated | null][] = [
  [
    /Preços ao Consumidor Amplo 15/i,
    {
      labelKo: "IPCA-15 (물가 선행)",
      unit: "%",
      refOffset: 0,
      sgs: 7478,
      focus: { indicador: "IPCA-15", kind: "month" },
      bounds: [-5, 8],
    },
  ],
  [/Preços ao Consumidor Amplo Especial/i, null],
  [
    /Preços ao Consumidor Amplo/i,
    {
      labelKo: "IPCA (소비자물가)",
      unit: "%",
      refOffset: -1,
      sgs: 433,
      focus: { indicador: "IPCA", kind: "month" },
      bounds: [-5, 8],
    },
  ],
  [
    /Amostra de Domicílios Contínua Mensal/i,
    {
      labelKo: "실업률 (PNAD)",
      unit: "%",
      refOffset: -1,
      sgs: 24369,
      focus: null,
      bounds: [2, 30],
    },
  ],
  [
    /Contas Nacionais Trimestrais/i,
    {
      labelKo: "GDP 분기 (PIB)",
      unit: "%",
      refOffset: 0,
      sgs: null,
      focus: { indicador: "PIB Total", kind: "quarter" },
      bounds: [-20, 20],
    },
  ],
];

function curatedFor(titulo: string): Curated | null {
  for (const [re, c] of CURATED) if (re.test(titulo)) return c;
  return null;
}

function brDateToIso(s: string): string | null {
  const m = s.trim().match(/^(\d{2})\/(\d{2})\/(\d{4})/);
  return m ? `${m[3]}-${m[2]}-${m[1]}` : null;
}

/** ISO → "MM/YYYY" (offset 개월 적용) */
function refMonth(iso: string, offset: number): string {
  const d = new Date(iso + "T00:00:00Z");
  d.setUTCMonth(d.getUTCMonth() + offset);
  return `${String(d.getUTCMonth() + 1).padStart(2, "0")}/${d.getUTCFullYear()}`;
}

/** ISO → "Q/YYYY" (발표월 기준 직전 분기) */
function refQuarter(iso: string): string {
  const d = new Date(iso + "T00:00:00Z");
  // Q1 발표 ~6월, Q2 ~9월, Q3 ~12월, Q4 ~3월(익년)
  const m = d.getUTCMonth() + 1;
  let year = d.getUTCFullYear();
  let q: number;
  if (m <= 4) {
    q = 4;
    year -= 1;
  } else if (m <= 7) q = 1;
  else if (m <= 10) q = 2;
  else q = 3;
  return `${q}/${year}`;
}

async function focusMedian(
  entity: "ExpectativaMercadoMensais" | "ExpectativasMercadoTrimestrais",
  indicador: string,
  dataRef: string
): Promise<number | null> {
  try {
    const url =
      `https://olinda.bcb.gov.br/olinda/servico/Expectativas/versao/v1/odata/${entity}` +
      `?$top=1&$orderby=Data desc&$format=json&$select=Mediana` +
      `&$filter=${encodeURIComponent(
        `Indicador eq '${indicador}' and DataReferencia eq '${dataRef}'`
      )}`;
    const res = await fetch(url);
    if (!res.ok) return null;
    const data = (await res.json()) as { value?: { Mediana?: number }[] };
    const v = data.value?.[0]?.Mediana;
    return typeof v === "number" ? v : null;
  } catch {
    return null;
  }
}

interface SgsRow {
  data: string;
  valor: string;
}

/**
 * SGS 월간 시리즈의 최근 24개월을 받아, 특정 참조월("MM/YYYY")의 값과
 * 가장 최근 값을 함께 돌려준다. 참조월이 아직 없으면 atRef=null.
 */
async function sgsMonthly(
  series: number,
  refMonthYear: string
): Promise<{ atRef: number | null; latest: number | null }> {
  try {
    const res = await fetch(
      `https://api.bcb.gov.br/dados/serie/bcdata.sgs.${series}/dados/ultimos/18?formato=json`
    );
    if (!res.ok) return { atRef: null, latest: null };
    const text = await res.text();
    if (!text.trimStart().startsWith("[")) return { atRef: null, latest: null };
    const arr = JSON.parse(text) as SgsRow[];
    const num = (s: string | undefined) => {
      const v = Number(s);
      return Number.isFinite(v) ? v : null;
    };
    const latest = num(arr[arr.length - 1]?.valor);
    const [rm, ry] = refMonthYear.split("/");
    const hit = arr.find((r) => {
      const m = r.data.match(/^(\d{2})\/(\d{2})\/(\d{4})/);
      return m && m[2] === rm && m[3] === ry;
    });
    return { atRef: hit ? num(hit.valor) : null, latest };
  } catch {
    return { atRef: null, latest: null };
  }
}

interface IbgeItem {
  titulo: string;
  data_divulgacao: string;
}

async function fetchIbge(from: string, to: string): Promise<AgendaItem[]> {
  let items: IbgeItem[] = [];
  try {
    const res = await fetch(
      `https://servicodados.ibge.gov.br/api/v3/calendario/?de=${from}&ate=${to}&qtd=200`
    );
    if (res.ok) items = ((await res.json()) as { items?: IbgeItem[] }).items ?? [];
  } catch {
    return [];
  }

  const today = new Date().toISOString().slice(0, 10);
  const seen = new Set<string>();
  const out: AgendaItem[] = [];

  for (const it of items) {
    const date = brDateToIso(it.data_divulgacao);
    if (!date) continue;
    const c = curatedFor(it.titulo);
    if (!c) continue;
    const key = `${date}|${c.labelKo}`;
    if (seen.has(key)) continue;
    seen.add(key);

    let guidance: number | null = null;
    if (c.focus) {
      const ref =
        c.focus.kind === "month"
          ? refMonth(date, c.refOffset)
          : refQuarter(date);
      guidance = await focusMedian(
        c.focus.kind === "month"
          ? "ExpectativaMercadoMensais"
          : "ExpectativasMercadoTrimestrais",
        c.focus.indicador,
        ref
      );
    }

    const released = date <= today;
    const expectedRef =
      c.focus?.kind === "quarter" ? null : refMonth(date, c.refOffset);

    // 발표치는 "정확히 해당 참조월"의 SGS 값, 직전치는 최근 가용값
    let atRef: number | null = null;
    let latest: number | null = null;
    if (c.sgs != null && expectedRef) {
      const r = await sgsMonthly(c.sgs, expectedRef);
      atRef = r.atRef;
      latest = r.latest;
    }

    // 무료 검증: 상식 범위를 벗어난 값은 버린다(소스/파싱 오류 방지)
    const check = (v: number | null) =>
      v != null && inRange(v, c.bounds) ? v : null;
    const g = check(guidance);
    const a = check(atRef);
    const p = check(latest);

    const fmt = (v: number) => `${v.toFixed(2)}${c.unit}`;
    out.push({
      date,
      titleKo: c.labelKo,
      category: "경제지표",
      released,
      guidance: g != null ? fmt(g) : null,
      actual: released && a != null ? fmt(a) : null,
      prior: !released && p != null ? fmt(p) : null,
    });
  }
  return out;
}

function holidaysInRange(fromIso: string, toIso: string): AgendaItem[] {
  const from = new Date(fromIso);
  const to = new Date(toIso);
  const out: AgendaItem[] = [];
  for (const y of new Set([from.getFullYear(), to.getFullYear()])) {
    for (const h of brazilHolidayList(y)) {
      if (h.date >= from && h.date <= to) {
        out.push({
          date: h.date.toISOString().slice(0, 10),
          titleKo: `${h.name} · 브라질 시장 휴장`,
          category: "휴장",
          released: false,
          guidance: null,
          actual: null,
          prior: null,
        });
      }
    }
  }
  return out;
}

export async function fetchBrazilAgenda(
  backDays = 7,
  forwardDays = 21
): Promise<AgendaItem[]> {
  const now = new Date();
  const start = new Date(now);
  start.setDate(start.getDate() - backDays);
  const end = new Date(now);
  end.setDate(end.getDate() + forwardDays);
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  const from = iso(start);
  const to = iso(end);

  const [ibge] = await Promise.all([fetchIbge(from, to)]);
  const holidays = holidaysInRange(from, to);

  return [...ibge, ...holidays].sort(
    (a, b) => a.date.localeCompare(b.date) || a.category.localeCompare(b.category)
  );
}
