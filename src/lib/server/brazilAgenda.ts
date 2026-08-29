import { brazilHolidayList } from "@/lib/brazilCalendar";

/**
 * 브라질 주요일정 — 조회일 기준 향후 약 1개월의 경제지표 발표(IBGE 공식
 * 캘린더 API, 무인증)와 브라질 시장 휴장일(국경일)을 모아 한글 라벨로 반환한다.
 */

export interface AgendaItem {
  /** ISO 날짜 */
  date: string;
  titleKo: string;
  category: "경제지표" | "휴장";
  link: string | null;
}

/** IBGE 상품명 → 한글 라벨 (부분일치, 자주 나오는 것 위주) */
const IBGE_LABELS: [RegExp, string][] = [
  [/Preços ao Consumidor Amplo 15/i, "IPCA-15 (물가 선행지표)"],
  [/Preços ao Consumidor Amplo Especial/i, "IPCA-E (특별 소비자물가)"],
  [/Preços ao Consumidor Amplo/i, "IPCA (소비자물가지수)"],
  [/Índice Nacional de Preços ao Consumidor\b/i, "INPC (소비자물가지수)"],
  [/Contas Nacionais Trimestrais/i, "분기 GDP (PIB)"],
  [/Amostra de Domicílios Contínua Mensal/i, "월간 가계조사 (실업률)"],
  [/Amostra de Domicílios Contínua/i, "분기 가계조사 (고용)"],
  [/Pesquisa Mensal de Comércio/i, "월간 소매판매"],
  [/Pesquisa Mensal de Serviços/i, "월간 서비스업 활동"],
  [/Pesquisa Industrial Mensal/i, "월간 산업생산"],
  [/Custos e Índices da Construção/i, "건설비용지수 (SINAPI)"],
  [/Índice Nacional da Construção Civil/i, "건설비용지수 (INCC)"],
  [/Produção Agrícola/i, "농업생산 조사 (LSPA)"],
  [/Abate de Animais|Produção de Ovos|Leite/i, "축산 생산 통계"],
  [/Índice de Preços ao Produtor/i, "생산자물가지수 (IPP)"],
];

function labelForIbge(titulo: string): string | null {
  for (const [re, ko] of IBGE_LABELS) if (re.test(titulo)) return ko;
  return null;
}

function brDateToIso(s: string): string | null {
  const m = s.trim().match(/^(\d{2})\/(\d{2})\/(\d{4})/);
  return m ? `${m[3]}-${m[2]}-${m[1]}` : null;
}

interface IbgeCalendarItem {
  titulo: string;
  data_divulgacao: string;
  link?: string;
  alias_produto?: string;
}

async function fetchIbge(from: string, to: string): Promise<AgendaItem[]> {
  try {
    const url = `https://servicodados.ibge.gov.br/api/v3/calendario/?de=${from}&ate=${to}&qtd=200`;
    const res = await fetch(url);
    if (!res.ok) return [];
    const data = (await res.json()) as { items?: IbgeCalendarItem[] };
    const items = data.items ?? [];
    const seen = new Set<string>();
    const out: AgendaItem[] = [];
    for (const it of items) {
      const date = brDateToIso(it.data_divulgacao);
      const label = labelForIbge(it.titulo);
      if (!date || !label) continue; // 관심 지표만
      const key = `${date}|${label}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({
        date,
        titleKo: label,
        category: "경제지표",
        link: it.alias_produto
          ? `https://www.ibge.gov.br/estatisticas/economicas/precos-e-custos.html`
          : null,
      });
    }
    return out;
  } catch {
    return [];
  }
}

function holidaysInRange(fromIso: string, toIso: string): AgendaItem[] {
  const from = new Date(fromIso);
  const to = new Date(toIso);
  const years = new Set([from.getFullYear(), to.getFullYear()]);
  const out: AgendaItem[] = [];
  for (const y of years) {
    for (const h of brazilHolidayList(y)) {
      if (h.date >= from && h.date <= to) {
        const iso = h.date.toISOString().slice(0, 10);
        out.push({
          date: iso,
          titleKo: `${h.name} · 브라질 시장 휴장`,
          category: "휴장",
          link: null,
        });
      }
    }
  }
  return out;
}

export async function fetchBrazilAgenda(days = 31): Promise<AgendaItem[]> {
  const now = new Date();
  const end = new Date(now);
  end.setDate(end.getDate() + days);
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  const from = iso(now);
  const to = iso(end);

  const [ibge] = await Promise.all([fetchIbge(from, to)]);
  const holidays = holidaysInRange(from, to);

  return [...ibge, ...holidays].sort(
    (a, b) => a.date.localeCompare(b.date) || a.category.localeCompare(b.category)
  );
}
