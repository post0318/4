/**
 * BCB(브라질 중앙은행)가 다음 해 COPOM(통화정책위원회) 회의 일정을 발표하면
 * (매년 대개 전년도 6월 말경) 뉴스로 공지한다 — 정식 API는 없고 사람이 읽는
 * 보도자료뿐이라, 일반 뉴스 피드(BCB 사이트 자체 API, 무인증)를 매일 훑어
 * 제목에 "Copom"+"calend" 가 같이 있는 글을 찾고 본문에서 "27 e 28 de
 * janeiro" 형식의 날짜쌍을 정규식으로 뽑는다.
 *
 * 오너 지시(2026-09-23 — "손으로 하드코딩을 내가하는거는 아니겠지?... 매일
 * 확인하여 업데이트할 수 있는 방향"): 사람이 매년 손으로 표를 채우는 대신
 * 이 스크립트가 발표 즉시 자동으로 src/lib/server/copom-calendar.json 을
 * 갱신·커밋한다(GitHub Actions, .github/workflows/copom-calendar.yml, 매일).
 *
 * 안전장치: 한 해에 정확히 8회(2006년부터 유지된 격월 체제)가 아니면,
 * 이미 그 해가 파일에 있으면 통째로 무시하고 아무것도 쓰지 않는다(오탐으로
 * 캘린더를 망가뜨리느니 그냥 다음날 재시도하는 쪽이 안전 — 이 프로젝트
 * 전반의 "실패 시 조용히 생략" 원칙과 동일).
 */
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const JSON_PATH = join(__dirname, "..", "src", "lib", "server", "copom-calendar.json");

const MONTHS = {
  janeiro: 1, fevereiro: 2, março: 3, abril: 4, maio: 5, junho: 6,
  julho: 7, agosto: 8, setembro: 9, outubro: 10, novembro: 11, dezembro: 12,
};

const DATE_PAIR_RE =
  /(\d{1,2})\s+e\s+(\d{1,2})\s+de\s+(janeiro|fevereiro|março|abril|maio|junho|julho|agosto|setembro|outubro|novembro|dezembro)/gi;

function stripHtml(html) {
  return html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
}

function extractMeetingDates(bodyText, year) {
  const out = [];
  for (const m of bodyText.matchAll(DATE_PAIR_RE)) {
    const d1 = Number(m[1]);
    const d2 = Number(m[2]);
    const month = MONTHS[m[3].toLowerCase()];
    if (!month || d1 < 1 || d1 > 31 || d2 < 1 || d2 > 31) continue;
    const pad = (n) => String(n).padStart(2, "0");
    out.push({
      start: `${year}-${pad(month)}-${pad(d1)}`,
      end: `${year}-${pad(month)}-${pad(d2)}`,
    });
  }
  return out;
}

async function findCalendarAnnouncement(targetYear) {
  const res = await fetch("https://www.bcb.gov.br/api/servico/sitebcb/noticias?quantidade=30", {
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) throw new Error(`뉴스 피드 요청 실패 (${res.status})`);
  const data = await res.json();
  const items = data.conteudo ?? [];
  for (const it of items) {
    const titulo = it.titulo ?? "";
    if (!/copom/i.test(titulo) || !/calend/i.test(titulo)) continue;
    if (!titulo.includes(String(targetYear))) continue;
    return { titulo, corpo: stripHtml(it.corpo ?? "") };
  }
  return null;
}

async function main() {
  const stored = JSON.parse(readFileSync(JSON_PATH, "utf8"));
  const knownYears = new Set(stored.meetings.map((m) => m.year));
  const lastYear = Math.max(...stored.meetings.map((m) => m.year));
  const targetYear = lastYear + 1;

  if (knownYears.has(targetYear)) {
    console.log(`[fetch-copom-calendar] ${targetYear}년 일정 이미 있음 — 스킵`);
    return;
  }

  console.log(`[fetch-copom-calendar] ${targetYear}년 COPOM 캘린더 발표 확인 중...`);
  const found = await findCalendarAnnouncement(targetYear);
  if (!found) {
    console.log(`[fetch-copom-calendar] 아직 발표 안 됨(또는 최근 뉴스 30건 밖) — 스킵`);
    return;
  }

  const pairs = extractMeetingDates(found.corpo, targetYear);
  if (pairs.length !== 8) {
    console.log(
      `[fetch-copom-calendar] 기사 찾음("${found.titulo}")이나 날짜 ${pairs.length}쌍 추출(8개 기대) — 형식이 달라진 듯, 반영 보류`
    );
    return;
  }
  pairs.sort((a, b) => a.start.localeCompare(b.start));
  for (let i = 1; i < pairs.length; i++) {
    if (pairs[i].start <= pairs[i - 1].start) {
      console.log(`[fetch-copom-calendar] 날짜 순서 이상 — 반영 보류`);
      return;
    }
  }

  const lastNro = Math.max(...stored.meetings.map((m) => m.nro));
  const newMeetings = pairs.map((p, i) => ({
    year: targetYear,
    nro: lastNro + 1 + i,
    start: p.start,
    end: p.end,
    decisionDate: p.end,
  }));

  stored.meetings = [...stored.meetings, ...newMeetings];
  stored.generatedAt = new Date().toISOString();
  stored.source = `BC 뉴스 자동 인식("${found.titulo}") — ${new Date().toISOString().slice(0, 10)}`;

  writeFileSync(JSON_PATH, JSON.stringify(stored, null, 2) + "\n");
  console.log(`[fetch-copom-calendar] ${targetYear}년 8회분 추가 완료 (nro ${lastNro + 1}~${lastNro + 8})`);
}

main().catch((err) => {
  console.error("[fetch-copom-calendar] 실패:", err);
  // 실패해도 exit 1 로 죽이지 않음 — 다음날 워크플로가 다시 시도(오너가
  // 매번 확인할 필요 없게, 실패는 로그로만 남긴다).
});
