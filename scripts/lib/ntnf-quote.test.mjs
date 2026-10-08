import { test } from "node:test";
import assert from "node:assert/strict";
import { buildOrderQuotes } from "./ntnf-quote.mjs";

const M27 = "2027-01-01";
const M37 = "2037-01-01";
const csvDay = (entries) => new Map(entries.map(([m, buy, sell]) => [m, { buy, sell }]));
const csv1007 = () => new Map([["2026-10-07", csvDay([[M27, 13.19, 13.31], [M37, 12.9, 13.02]])]]);

test("실시간 같은 시각 같은 종목 쌍이 1순위(부호: 매수 < 매도)", () => {
  const q = buildOrderQuotes({
    maturities: [M37],
    csvByDate: csv1007(),
    live: { date: "2026-10-08", buy: new Map([[M37, 12.69]]), sell: new Map([[M37, 12.81]]) },
  }).get(M37);
  assert.equal(q.source, "live");
  assert.equal(q.quoteDate, "2026-10-08");
  assert.equal(q.buyRate, 12.69);
  assert.equal(q.sellRate, 12.81);
  assert.equal(q.spread, 0.12);
  assert.ok(q.buyRate < q.sellRate);
  assert.equal(q.estimated, false);
});

test("매수 호가가 없는 종목은 같은 시각 다른 종목 호가차로 추정", () => {
  const q = buildOrderQuotes({
    maturities: [M27, M37],
    csvByDate: csv1007(),
    live: { date: "2026-10-08", buy: new Map([[M37, 12.69]]), sell: new Map([[M27, 13.32], [M37, 12.81]]) },
  }).get(M27);
  assert.equal(q.source, "live-est");
  assert.equal(q.estimated, true);
  assert.deepEqual(q.spreadRef, [M37]);
  assert.equal(q.sellRate, 13.32);
  assert.equal(q.buyRate, 13.2);
});

test("실시간이 없으면 최신 CSV 같은 기준일 원값 쌍, '실시간 없음' 안내", () => {
  const q = buildOrderQuotes({ maturities: [M27], csvByDate: csv1007(), live: null }).get(M27);
  assert.equal(q.source, "csv");
  assert.equal(q.quoteDate, "2026-10-07");
  assert.equal(q.buyRate, 13.19);
  assert.equal(q.sellRate, 13.31);
  assert.match(q.note, /실시간 없음/);
});

test("실시간 매수 호가가 하나도 없으면 매도만 섞지 않고 CSV 쌍을 쓴다", () => {
  const q = buildOrderQuotes({
    maturities: [M27],
    csvByDate: csv1007(),
    live: { date: "2026-10-08", buy: new Map(), sell: new Map([[M27, 13.32]]) },
  }).get(M27);
  assert.equal(q.source, "csv");
  assert.equal(q.buyRate, 13.19);
  assert.equal(q.sellRate, 13.31);
});

test("CSV 보다 오래된 실시간은 쓰지 않는다", () => {
  const q = buildOrderQuotes({
    maturities: [M37],
    csvByDate: csv1007(),
    live: { date: "2026-10-06", buy: new Map([[M37, 12.5]]), sell: new Map([[M37, 12.62]]) },
  }).get(M37);
  assert.equal(q.source, "csv");
  assert.equal(q.quoteDate, "2026-10-07");
});

test("호가차 부호가 반대이거나 0.5%p 초과인 쌍은 쓰지 않고, 남는 게 없으면 비운다", () => {
  const q = buildOrderQuotes({
    maturities: [M27],
    csvByDate: new Map([
      ["2026-10-07", csvDay([[M27, 13.31, 13.19]])],
      ["2026-10-06", csvDay([[M27, 13.0, 13.9]])],
      ["2026-10-05", csvDay([[M27, 13.1, 13.22]])],
    ]),
    live: { date: "2026-10-08", buy: new Map([[M27, 13.4]]), sell: new Map([[M27, 13.3]]) },
  }).get(M27);
  assert.equal(q.quoteDate, "2026-10-05");
  assert.equal(q.buyRate, 13.1);

  const none = buildOrderQuotes({ maturities: [M27], csvByDate: new Map(), live: null }).get(M27);
  assert.equal(none.buyRate, null);
  assert.match(none.note, /비웠습니다/);
});
