import { brazilHolidayList } from "@/lib/brazilCalendar";
import { fetchOrNull } from "@/lib/server/fetchWithTimeout";
import { inRange, BOUNDS } from "@/lib/server/sanity";
import copomCalendar from "@/lib/server/copom-calendar.json";

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
  category: "경제지표" | "휴장" | "선거";
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
  /** 월간 발표치 SGS 시리즈 코드 */
  sgs: number | null;
  /** 분기 발표치 IBGE SIDRA (표·변수). 분기 지표(GDP) 전용 */
  sidra?: { table: number; variable: number };
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
      // SIDRA 5932, 변수 6561 = 전년동기比(YoY). Focus "PIB Total" 분기치와 같은 정의라 예상 vs 발표 비교가 성립.
      sidra: { table: 5932, variable: 6561 },
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
    const res = await fetchOrNull(url);
    if (!res) return null;
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
    const res = await fetchOrNull(
      `https://api.bcb.gov.br/dados/serie/bcdata.sgs.${series}/dados/ultimos/18?formato=json`
    );
    if (!res) return { atRef: null, latest: null };
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

/**
 * IBGE SIDRA 분기 지표의 특정 참조분기 값(%). refQuarter 는 "Q/YYYY"("2/2026").
 * 참조분기가 아직 발표 전이면 헤더 행만 오므로 null.
 */
async function sidraQuarterlyPct(
  table: number,
  variable: number,
  refQuarter: string
): Promise<number | null> {
  try {
    const [q, y] = refQuarter.split("/");
    const period = `${y}${q.padStart(2, "0")}`; // "2/2026" → "202602"
    const res = await fetchOrNull(
      `https://apisidra.ibge.gov.br/values/t/${table}/n1/1/v/${variable}/p/${period}/c11255/90707`
    );
    if (!res) return null;
    const rows = (await res.json()) as { V?: string }[];
    const v = Number(rows?.[1]?.V);
    return Number.isFinite(v) ? v : null;
  } catch {
    return null;
  }
}

interface IbgeItem {
  titulo: string;
  data_divulgacao: string;
}

async function fetchIbge(from: string, to: string): Promise<AgendaItem[]> {
  let items: IbgeItem[] = [];
  try {
    const res = await fetchOrNull(
      `https://servicodados.ibge.gov.br/api/v3/calendario/?de=${from}&ate=${to}&qtd=200`
    );
    if (res) items = ((await res.json()) as { items?: IbgeItem[] }).items ?? [];
  } catch {
    return [];
  }

  const today = new Date().toISOString().slice(0, 10);

  // 1단계: 큐레이션 대상만 골라 중복 제거 (동기).
  const seen = new Set<string>();
  const targets: { date: string; c: NonNullable<ReturnType<typeof curatedFor>> }[] = [];
  for (const it of items) {
    const date = brDateToIso(it.data_divulgacao);
    if (!date) continue;
    const c = curatedFor(it.titulo);
    if (!c) continue;
    const key = `${date}|${c.labelKo}`;
    if (seen.has(key)) continue;
    seen.add(key);
    targets.push({ date, c });
  }

  // 2단계: 지표별 Focus(컨센서스)·SGS/SIDRA(발표치) 조회를 전부 병렬로.
  // 예전에는 지표마다 순차 await 라 지표 10개면 외부 호출 20회를 줄 세워 기다렸다
  // (감사 ⑤ 중9). 개별 실패는 각 함수가 null 로 흡수하므로 Promise.all 로 충분.
  return Promise.all(
    targets.map(async ({ date, c }): Promise<AgendaItem> => {
      const released = date <= today;
      const isQuarter = c.focus?.kind === "quarter";
      const expectedRef = isQuarter ? null : refMonth(date, c.refOffset);

      const guidanceP: Promise<number | null> = c.focus
        ? focusMedian(
            c.focus.kind === "month"
              ? "ExpectativaMercadoMensais"
              : "ExpectativasMercadoTrimestrais",
            c.focus.indicador,
            c.focus.kind === "month" ? refMonth(date, c.refOffset) : refQuarter(date)
          )
        : Promise.resolve(null);

      // 발표치: 월간은 "정확히 해당 참조월"의 SGS 값, 분기는 IBGE SIDRA 참조분기 값.
      // 직전치(prior)는 월간 SGS 최근 가용값.
      const actualP: Promise<{ atRef: number | null; latest: number | null }> =
        c.sgs != null && expectedRef
          ? sgsMonthly(c.sgs, expectedRef)
          : isQuarter && c.sidra
            ? sidraQuarterlyPct(c.sidra.table, c.sidra.variable, refQuarter(date)).then(
                (atRef) => ({ atRef, latest: null })
              )
            : Promise.resolve({ atRef: null, latest: null });

      const [guidance, { atRef, latest }] = await Promise.all([guidanceP, actualP]);

      // 무료 검증: 상식 범위를 벗어난 값은 버린다(소스/파싱 오류 방지)
      const check = (v: number | null) =>
        v != null && inRange(v, c.bounds) ? v : null;
      const g = check(guidance);
      const a = check(atRef);
      const p = check(latest);

      const fmt = (v: number) => `${v.toFixed(2)}${c.unit}`;
      return {
        date,
        titleKo: c.labelKo,
        category: "경제지표",
        released,
        guidance: g != null ? fmt(g) : null,
        actual: released && a != null ? fmt(a) : null,
        prior: !released && p != null ? fmt(p) : null,
      };
    })
  );
}

/** 매 10월 첫째 일요일(1차)·마지막 일요일(결선) — 대선 연도는 4년 주기(≡2 mod 4) */
function brazilElectionItems(): AgendaItem[] {
  const now = new Date();
  let year = now.getUTCFullYear();
  while (year % 4 !== 2 || new Date(Date.UTC(year, 10, 1)) < now) year++;

  const oct1 = new Date(Date.UTC(year, 9, 1));
  const firstSun = 1 + ((7 - oct1.getUTCDay()) % 7);
  const oct31 = new Date(Date.UTC(year, 9, 31));
  const lastSun = 31 - oct31.getUTCDay();
  const iso = (day: number) =>
    `${year}-10-${String(day).padStart(2, "0")}`;

  return [
    {
      date: iso(firstSun),
      titleKo: `브라질 대선 1차 투표 (${year})`,
      category: "선거",
      released: false,
      guidance: null,
      actual: null,
      prior: null,
    },
    {
      date: iso(lastSun),
      titleKo: `브라질 대선 결선 투표 (${year}, 필요 시)`,
      category: "선거",
      released: false,
      guidance: null,
      actual: null,
      prior: null,
    },
  ];
}

// ── COPOM 기준금리 결정 ──────────────────────────────────────────────
// 기존 "경제지표" 항목은 전부 IBGE 캘린더(통계청)에서만 왔는데, 금리결정은
// IBGE가 아니라 중앙은행(BCB) COPOM 소관이라 애초에 이 소스에 없었다(오너
// 지적, 2026-09-23 — "주요일정에 금리결정에 대한 일정은 없는데"). 과거
// 결정은 BCB 사이트 자체 API로 정확한 결정일을 받고, 그 결정으로 바뀐
// Selic 값은 SGS 일별시계열(432)에서 결정일 전/후 값을 대조해 계산한다
// (동결도 여기서 자연스럽게 "동결 X%"로 표시됨 — 값이 안 바뀌는 결정도
// 놓치지 않음, 시계열 변화만 보는 방식의 약점을 피함).

interface BcbAtaItem {
  nroReuniao: number;
  dataReferencia: string; // "YYYY-MM-DD", 실제 결정일(이틀째 저녁 발표일)
  dataPublicacao: string;
}

function toBrDate(iso: string): string {
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
}

function addDaysIso(iso: string, days: number): string {
  const d = new Date(iso + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** 결정일 전후 Selic(SGS 432, 일별) 값 — before=결정일 이전 마지막 값,
 * after=결정일 이후 첫 값(보통 결정 다음 영업일부터 반영). */
async function selicAround(decisionDateIso: string): Promise<{ before: number | null; after: number | null }> {
  try {
    const res = await fetchOrNull(
      `https://api.bcb.gov.br/dados/serie/bcdata.sgs.432/dados?dataInicial=${toBrDate(addDaysIso(decisionDateIso, -5))}&dataFinal=${toBrDate(addDaysIso(decisionDateIso, 7))}&formato=json`
    );
    if (!res) return { before: null, after: null };
    const rows = (await res.json()) as { data: string; valor: string }[];
    const num = (s: string | undefined) => {
      const n = Number(s);
      return Number.isFinite(n) ? n : null;
    };
    let before: number | null = null;
    let after: number | null = null;
    for (const r of rows) {
      const m = r.data.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
      if (!m) continue;
      const iso = `${m[3]}-${m[2]}-${m[1]}`;
      if (iso <= decisionDateIso) before = num(r.valor);
      else if (after == null) after = num(r.valor);
    }
    return { before, after };
  } catch {
    return { before: null, after: null };
  }
}

async function fetchCopomDecisions(from: string, to: string): Promise<AgendaItem[]> {
  let atas: BcbAtaItem[] = [];
  try {
    // 창(최대 backDays+forwardDays≈1개월)에 걸리는 회차만 있으면 되지만, 발표
    // 지연·재조회 여유로 최근 6회분을 넉넉히 받는다(호출 1번, 비용 없음).
    const res = await fetchOrNull("https://www.bcb.gov.br/api/servico/sitebcb/copom/atas?quantidade=6");
    if (res) atas = ((await res.json()) as { conteudo?: BcbAtaItem[] }).conteudo ?? [];
  } catch {
    return [];
  }

  const inWindow = atas.filter((a) => a.dataReferencia >= from && a.dataReferencia <= to);
  if (inWindow.length === 0) return [];

  return Promise.all(
    inWindow.map(async (a): Promise<AgendaItem> => {
      const { before, after } = await selicAround(a.dataReferencia);
      const b = inRange(before, BOUNDS.ratePct) ? before : null;
      const af = inRange(after, BOUNDS.ratePct) ? after : null;
      const bp = b != null && af != null ? Math.round((af - b) * 100) : null;
      const actual =
        af != null
          ? bp === 0
            ? `동결 ${af.toFixed(2)}%`
            : `${af.toFixed(2)}% (${bp! > 0 ? "+" : ""}${bp}bp)`
          : null;
      return {
        date: a.dataReferencia,
        titleKo: `COPOM 기준금리(Selic) 결정 — ${a.nroReuniao}차`,
        category: "경제지표",
        released: true,
        guidance: null,
        actual,
        prior: b != null ? `${b.toFixed(2)}%` : null,
      };
    })
  );
}

interface CopomMeeting {
  year: number;
  nro: number;
  start: string;
  end: string;
  decisionDate: string;
}

/** 최신 Selic 값(SGS 432) — 아직 안 열린 회의의 "이전" 칸에 쓴다. 다음 결정이
 * 나오기 전까지는 이미 발표된 현재 금리가 곧 "이전 값"이다(오너 지적,
 * 2026-09-23 — "11월4일 282차에 이전 수치가 안나온다. 이전은 이미 발표한거니"). */
async function latestSelicRate(): Promise<number | null> {
  try {
    const res = await fetchOrNull(`https://api.bcb.gov.br/dados/serie/bcdata.sgs.432/dados/ultimos/1?formato=json`);
    if (!res) return null;
    const rows = (await res.json()) as { valor: string }[];
    const v = Number(rows?.[0]?.valor);
    return inRange(v, BOUNDS.ratePct) ? v : null;
  } catch {
    return null;
  }
}

/** 아직 안 열린(미래) COPOM 회의만 — 이미 열린 회차는 fetchCopomDecisions가
 * BCB API로 정확한 결과와 함께 다룬다(중복 방지). 매년 새 캘린더가 나오면
 * scripts/fetch-copom-calendar.mjs 가 이 JSON에 자동으로 추가한다. */
async function copomCalendarItems(from: string, to: string): Promise<AgendaItem[]> {
  const today = new Date().toISOString().slice(0, 10);
  const meetings = (copomCalendar as { meetings: CopomMeeting[] }).meetings;
  const upcoming = meetings.filter(
    (m) => m.decisionDate > today && m.decisionDate >= from && m.decisionDate <= to
  );
  if (upcoming.length === 0) return [];
  const current = await latestSelicRate();
  return upcoming.map((m) => ({
    date: m.decisionDate,
    titleKo: `COPOM 기준금리(Selic) 결정 예정 — ${m.nro}차 (${m.start.slice(5)}~${m.end.slice(5)})`,
    category: "경제지표",
    released: false,
    guidance: null,
    actual: null,
    prior: current != null ? `${current.toFixed(2)}%` : null,
    }));
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

  const [ibge, copomPast, copomFuture] = await Promise.all([
    fetchIbge(from, to),
    fetchCopomDecisions(from, to),
    copomCalendarItems(from, to),
  ]);
  const holidays = holidaysInRange(from, to);

  const windowed = [...ibge, ...copomPast, ...copomFuture, ...holidays].sort(
    (a, b) => a.date.localeCompare(b.date) || a.category.localeCompare(b.category)
  );

  // 대선 — 다가오는 회차는 창 밖이어도 넣고, 지난 회차는 창 안이면 TSE 개표 결과와 함께
  // (오너 지시 2026-10-11 — 지난 일정에 선거 결과)
  const elections = await withElectionResults(
    brazilElectionItems().filter((e) => e.date >= from)
  );

  return [...elections, ...windowed].sort(
    (a, b) => a.date.localeCompare(b.date) || a.category.localeCompare(b.category)
  );
}

// ── 대선 개표 결과 (TSE 공식 JSON) ──────────────────────────────────
// resultados.tse.jus.br/oficial/ele{연도}/{선거코드}/dados/br/br-c0001-e{코드6자리}-u.json
// (c0001 = 대통령). 선거코드는 회차마다 TSE 가 새로 정한다 — 2026: 1차 6257 · 결선 6258
// (2026-10-11 실측). 다음 대선(2030)은 코드를 확인해 여기에 추가해야 결과가 붙는다.
const TSE_PRESIDENT_CODES: Record<number, [number, number]> = { 2026: [6257, 6258] };

const KO_NAMES: Record<string, string> = {
  "FLAVIO BOLSONARO": "플라비우 보우소나루",
  LULA: "룰라",
};

function koName(nmu: string): string {
  return (
    KO_NAMES[nmu] ??
    nmu
      .toLowerCase()
      .replace(/(^|\s)\p{L}/gu, (m) => m.toUpperCase())
  );
}

interface TseCand {
  nmu: string;
  seq: string;
  pvap: string;
  st: string;
}

async function tseResult(year: number, round: 0 | 1): Promise<string | null> {
  const code = TSE_PRESIDENT_CODES[year]?.[round];
  if (!code) return null;
  const res = await fetchOrNull(
    `https://resultados.tse.jus.br/oficial/ele${year}/${code}/dados/br/br-c0001-e${String(code).padStart(6, "0")}-u.json`,
    { headers: { "user-agent": "Mozilla/5.0" } },
    8000
  );
  if (!res) return null;
  try {
    const j = (await res.json()) as {
      s?: { pst?: string };
      carg?: { agr?: { par?: { cand?: TseCand[] }[] }[] }[];
    };
    const cands = (j.carg?.[0]?.agr ?? [])
      .flatMap((a) => a.par ?? [])
      .flatMap((p) => p.cand ?? [])
      .sort((a, b) => Number(a.seq) - Number(b.seq));
    const pct = (c: TseCand) => `${c.pvap.replace(",", ".")}%`;
    const top = cands.slice(0, 2).filter((c) => c.pvap && c.pvap !== "0,00");
    if (top.length === 0) return null;
    const status = (c: TseCand) =>
      /2º turno/i.test(c.st) ? " 결선 진출" : /^eleito/i.test(c.st) ? " 당선" : "";
    const counted = j.s?.pst && j.s.pst !== "100,00" ? ` (개표 ${j.s.pst.replace(",", ".")}%)` : "";
    return top.map((c) => `${koName(c.nmu)} ${pct(c)}${status(c)}`).join(" · ") + counted;
  } catch {
    return null;
  }
}

/** 지난 회차(오늘 이전)에만 결과를 붙인다. 결과를 못 받으면 항목은 그대로(결과 없음) */
async function withElectionResults(items: AgendaItem[]): Promise<AgendaItem[]> {
  const today = new Date().toISOString().slice(0, 10);
  const out = await Promise.all(
    items.map(async (e) => {
      if (e.date >= today) return e;
      const year = Number(e.date.slice(0, 4));
      const round: 0 | 1 = e.titleKo.includes("결선") ? 1 : 0;
      const actual = await tseResult(year, round);
      return actual ? { ...e, released: true, actual } : e;
    })
  );
  // 1차에서 결선이 확정되면 결선 항목의 "필요 시"를 빼고 대진을 적는다
  const first = out.find((e) => !e.titleKo.includes("결선") && e.actual?.includes("결선 진출"));
  if (!first?.actual) return out;
  const pair = first.actual
    .split(" · ")
    .filter((s) => s.includes("결선 진출"))
    .map((s) => s.replace(/\s[\d.]+%.*$/, ""));
  return out.map((e) =>
    e.titleKo.includes("결선") && e.date >= today
      ? { ...e, titleKo: e.titleKo.replace(", 필요 시)", ")") + (pair.length === 2 ? ` — ${pair[0]} vs ${pair[1]}` : "") }
      : e
  );
}
