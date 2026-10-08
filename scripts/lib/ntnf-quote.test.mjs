import { test } from "node:test";
import assert from "node:assert/strict";
import { buildMidSpreadQuotes } from "./ntnf-quote.mjs";

const M27 = "2027-01-01";
const M37 = "2037-01-01";
const csvDay = (entries) => new Map(entries.map(([m, buy, sell]) => [m, { buy, sell }]));
const anbDay = (entries) => new Map(entries);

test("CSV 만 있으면 중간값 ∓ 호가차/2 가 CSV 원값과 같다(부호: 매수 < 매도)", () => {
  const q = buildMidSpreadQuotes({
    maturities: [M27],
    csvByDate: new Map([["2026-10-07", csvDay([[M27, 13.19, 13.31]])]]),
    anbimaByDate: new Map(),
    live: null,
  }).get(M27);
  assert.equal(q.quoteDate, "2026-10-07");
  assert.equal(q.midSource, "csv");
  assert.equal(q.spreadSource, "csv");
  assert.equal(q.midRate, 13.25);
  assert.equal(q.spread, 0.12);
  assert.equal(q.buyRate, 13.19);
  assert.equal(q.sellRate, 13.31);
  assert.ok(q.buyRate < q.midRate && q.midRate < q.sellRate);
  assert.equal(q.estimated, false);
});

test("같은 기준일 ANBIMA 가 있으면 중간값은 ANBIMA, 호가차는 같은 기준일 CSV", () => {
  const q = buildMidSpreadQuotes({
    maturities: [M27],
    csvByDate: new Map([["2026-10-07", csvDay([[M27, 13.19, 13.31]])]]),
    anbimaByDate: new Map([["2026-10-07", anbDay([[M27, 13.2323]])]]),
    live: null,
  }).get(M27);
  assert.equal(q.midSource, "anbima");
  assert.equal(q.spreadSource, "csv");
  assert.equal(q.buyRate, 13.1723);
  assert.equal(q.sellRate, 13.2923);
  assert.match(q.note, /ANBIMA/);
  assert.match(q.note, /재무부 CSV/);
});

test("ANBIMA 가 CSV 보다 하루 늦게 있어도 다른 날 CSV 호가차를 섞지 않고 같은 기준일로 내려간다", () => {
  const q = buildMidSpreadQuotes({
    maturities: [M27],
    csvByDate: new Map([["2026-10-06", csvDay([[M27, 13.18, 13.3]])]]),
    anbimaByDate: new Map([
      ["2026-10-07", anbDay([[M27, 13.2323]])],
      ["2026-10-06", anbDay([[M27, 13.21]])],
    ]),
    live: null,
  }).get(M27);
  assert.equal(q.quoteDate, "2026-10-06");
  assert.equal(q.midRate, 13.21);
  assert.equal(q.buyRate, 13.15);
});

test("ANBIMA 만 있고 그날 호가차가 없으면 다음으로 이른 날, 아무 날도 없으면 비우고 사유", () => {
  const q = buildMidSpreadQuotes({
    maturities: [M27],
    csvByDate: new Map(),
    anbimaByDate: new Map([["2026-10-07", anbDay([[M27, 13.2323]])]]),
    live: null,
  }).get(M27);
  assert.equal(q.buyRate, null);
  assert.equal(q.sellRate, null);
  assert.match(q.note, /비웠습니다/);
});

test("실시간: 매수·매도가 같은 시각에 다 있으면 그 쌍, 매도만 있는 종목은 다른 종목 호가차로 추정", () => {
  const quotes = buildMidSpreadQuotes({
    maturities: [M27, M37],
    csvByDate: new Map([["2026-10-07", csvDay([[M27, 13.19, 13.31], [M37, 12.9, 13.02]])]]),
    anbimaByDate: new Map([["2026-10-07", anbDay([[M27, 13.2323], [M37, 12.9286]])]]),
    live: { date: "2026-10-08", buy: new Map([[M37, 12.69]]), sell: new Map([[M27, 13.32], [M37, 12.81]]) },
  });
  const a = quotes.get(M37);
  assert.equal(a.quoteDate, "2026-10-08");
  assert.equal(a.midSource, "live");
  assert.equal(a.spreadSource, "live");
  assert.equal(a.midRate, 12.75);
  assert.equal(a.buyRate, 12.69);
  assert.equal(a.sellRate, 12.81);
  assert.equal(a.estimated, false);

  const b = quotes.get(M27);
  assert.equal(b.quoteDate, "2026-10-08");
  assert.equal(b.midSource, "live-sell");
  assert.equal(b.spreadSource, "live-other");
  assert.deepEqual(b.spreadRef, [M37]);
  assert.equal(b.estimated, true);
  assert.equal(b.sellRate, 13.32);
  assert.equal(b.buyRate, 13.2);
});

test("실시간 매수 호가가 하나도 없으면 실시간 날짜는 건너뛰고 확정 자료(같은 기준일 ANBIMA+CSV)를 쓴다", () => {
  const q = buildMidSpreadQuotes({
    maturities: [M27],
    csvByDate: new Map([["2026-10-07", csvDay([[M27, 13.19, 13.31]])]]),
    anbimaByDate: new Map([["2026-10-07", anbDay([[M27, 13.2323]])]]),
    live: { date: "2026-10-08", buy: new Map(), sell: new Map([[M27, 13.32]]) },
  }).get(M27);
  assert.equal(q.quoteDate, "2026-10-07");
  assert.equal(q.midSource, "anbima");
  assert.equal(q.estimated, false);
});

test("실시간과 CSV 가 같은 날이면 매수·매도를 섞지 않고 CSV 쌍으로 호가차를 잡는다", () => {
  const q = buildMidSpreadQuotes({
    maturities: [M27],
    csvByDate: new Map([["2026-10-08", csvDay([[M27, 13.19, 13.31]])]]),
    anbimaByDate: new Map(),
    live: { date: "2026-10-08", buy: new Map(), sell: new Map([[M27, 13.5]]) },
  }).get(M27);
  assert.equal(q.midSource, "csv");
  assert.equal(q.spreadSource, "csv");
  assert.equal(q.buyRate, 13.19);
  assert.equal(q.sellRate, 13.31);
});

test("호가차 부호가 반대(매도 ≤ 매수)이거나 0.5%p 초과인 출처는 쓰지 않는다", () => {
  const q = buildMidSpreadQuotes({
    maturities: [M27],
    csvByDate: new Map([
      ["2026-10-07", csvDay([[M27, 13.31, 13.19]])],
      ["2026-10-06", csvDay([[M27, 13.0, 13.9]])],
      ["2026-10-05", csvDay([[M27, 13.1, 13.22]])],
    ]),
    anbimaByDate: new Map(),
    live: null,
  }).get(M27);
  assert.equal(q.quoteDate, "2026-10-05");
  assert.equal(q.buyRate, 13.1);
  assert.equal(q.sellRate, 13.22);
});
