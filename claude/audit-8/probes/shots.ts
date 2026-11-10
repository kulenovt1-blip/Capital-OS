// @ts-nocheck
import { chromium } from '/opt/npm-tools/node_modules/playwright/index.mjs';
import { writeFileSync } from 'node:fs';
import { serializeState, emptyState } from '../../../engine/index';
import { computeIndicators } from '../../../engine/position/indicators';
import { BASE, STATES, todayOf } from '../../../scripts/ui-states';
import { build, mk, randomSpec, independenceProfiles, SPECS2, TODAY as PT } from '../../../tests/support/position-profiles';
import { acc, trf } from '../../../tests/support/build';
const prof = (st) => ({ ...st, settings: { ...st.settings, firstRunDone: true } });
const thr = () => { const sp = (o) => mk('X', o, 600_000, [['food', 'E_base', 150_000], ['rent', 'E_base', 150_000], ['fun', 'E_fun', 290_000]]); const i0 = computeIndicators(build(sp(0)), PT).inputs; return prof(build(sp(Math.round(3 * i0.needEssential - i0.netLiquid)))); };
const usd = () => { const s = build(SPECS2[1]); const d = s.imported; return prof({ ...s, imported: { ...d, accounts: [...d.accounts, acc('usd', 'Доллары', { currency: 'USD' })], operations: [...d.operations, trf('2026-10-28', 'save', 'usd', 1_500_000, 3_000)].sort((a, b) => (a.date < b.date ? -1 : 1)) }, settings: { ...s.settings, accounts: [...s.settings.accounts, { ...s.settings.accounts[1], accountId: 'usd' }] } }); };
const CUSTOM = {
  'x-R9-11mes-ur2': () => prof(build(randomSpec(9))),
  'x-FI4-516mes-ur3': () => prof(independenceProfiles().find((p) => p.name === 'FI4').state),
  'x-noessential': () => prof(build(mk('Z2', 1_000_000, 300_000, [['fun', 'E_fun', 100_000]]))),
  'x-threshold3': thr,
  'x-usd': usd,
};
const plan = [
  ['empty', ['overview', '#/position'], 'none'],
  ...['pos-l4', 'pos-l5', 'pos-limit', 'pos-border', 'pos-spiral', 'pos-short', 'configured'].map((n) => [n, null, 'std']),
  ...Object.keys(CUSTOM).map((n) => [n, null, 'custom']),
];
const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome' });
for (const [name] of plan) {
  const st = CUSTOM[name] ? CUSTOM[name]() : STATES[name]();
  const today = CUSTOM[name] ? PT : todayOf(name);
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, colorScheme: 'dark' });
  const page = await ctx.newPage();
  const errs = []; page.on('pageerror', (e) => errs.push(e.message));
  await page.goto(`${BASE}/?today=${today}`);
  await page.evaluate((v) => new Promise((res, rej) => { const r = indexedDB.open('capital-os', 1); r.onupgradeneeded = () => r.result.createObjectStore('kv'); r.onsuccess = () => { const t = r.result.transaction('kv', 'readwrite'); t.objectStore('kv').put(v, 'state'); t.oncomplete = () => (r.result.close(), res()); t.onerror = () => rej(t.error); }; }), serializeState(st, today));
  for (const [scr, hash] of [['position', '#/position'], ['overview', '#/overview'], ['reserve-info', '#/overview~reserve-info']]) {
    await page.goto(`${BASE}/?today=${today}${hash}`); await page.reload(); await page.waitForTimeout(500);
    const text = await page.evaluate(() => document.body.innerText);
    writeFileSync(`claude/audit-8/shots/${name}__${scr}.txt`, text);
    await page.screenshot({ path: `claude/audit-8/shots/${name}__${scr}.png`, fullPage: scr === 'position' });
  }
  if (errs.length) console.log(name, 'ошибки', errs);
  await ctx.close();
}
await browser.close();
console.log('ok');
