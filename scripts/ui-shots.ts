/**
 * Скриншоты интерфейса для сравнения «до / после» (bun scripts/ui-shots.ts <этап>).
 *
 * Состояния собираются движком и кладутся прямо в IndexedDB — так снимки не зависят от того,
 * как устроены формы в текущей версии интерфейса. Нужен запущенный сервер:
 *   PORT=5199 bun scripts/dev-server.ts &
 * Снимки: ui-shots/<этап>/<состояние>-<экран>-<вариант>.png (папка в .gitignore).
 */
// @ts-nocheck — служебный скрипт для Bun
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import {
  emptyState, importMmbackup, mergeAccountSettings, serializeState, setCategoryClass, exampleGoals, detectInstallments,
  suggestionToObligation, remainingFromTerm, tenge, type AppState,
} from '../engine/index';
import { readFileSync } from 'node:fs';

const ROOT = join(import.meta.dir, '..');
const BASE = process.env.UI_URL ?? 'http://localhost:5199';
const TODAY = '2026-10-28';
const stage = process.argv[2] ?? 'current';
const only = process.argv[3]; // необязательно: снять только один экран
const OUT = join(ROOT, 'ui-shots', stage);
mkdirSync(OUT, { recursive: true });

const fixture = (name: string) => new Uint8Array(readFileSync(join(ROOT, 'tests/fixtures', name)));

function imported(file: string): AppState {
  const data = importMmbackup(fixture(file));
  const s = emptyState();
  return { ...s, imported: data, importedAt: TODAY, settings: { ...s.settings, accounts: mergeAccountSettings([], data.accounts) } };
}

/** Всё настроено: разметка, ответ о счёте, доходы, рассрочки, цели с деньгами — для «полных» экранов. */
function configured(): AppState {
  const st = imported('synthetic.mmbackup');
  let cls = st.settings.classification;
  const map: Record<string, [string, 'income' | 'expense']> = {
    'cat-food': ['E_base', 'expense'], 'cat-transport': ['E_base', 'expense'], 'cat-phone': ['E_base', 'expense'], 'cat-fun': ['E_fun', 'expense'],
    'cat-family': ['E_family', 'expense'], 'cat-fee': ['E_other', 'expense'], 'cat-old': ['E_other', 'expense'], 'cat-salary': ['I_work', 'income'], 'cat-stipend': ['I_stipend', 'income'],
  };
  for (const [id, [c, k]] of Object.entries(map)) {
    const cat = st.imported!.categories.find((x) => x.id === id);
    if (cat) cls = setCategoryClass(cls, cat, c as never, k);
  }
  st.settings.classification = cls;
  st.settings.accounts = st.settings.accounts.map((a) => (a.accountId === 'acc-tech' ? { ...a, excluded: true, reviewed: true } : a));
  st.settings.incomeSchedule = [
    { id: 'sal', title: 'Зарплата', dayOfMonth: 5, amount: tenge(180_000), kind: 'work' },
    { id: 'stip', title: 'Стипендия', dayOfMonth: 10, amount: tenge(38_000), kind: 'stable', end: '2027-06-30' },
  ];
  st.settings.savingsFlows = { mode: 'estimate', confirmed: true };
  for (const s of detectInstallments(st, TODAY).suggestions) {
    const r = remainingFromTerm(s, 12);
    if (r.ok) st.obligations.push(suggestionToObligation(s, { id: `ob-${s.key}`, remaining: r.remaining, today: TODAY }));
  }
  const targets: Record<string, number> = { 'goal-move': 600_000, 'goal-move-start': 400_000, 'goal-move-buffer': 200_000, 'goal-teeth': 150_000 };
  st.goals = exampleGoals(TODAY).map((g) => (targets[g.id] ? { ...g, targetMin: tenge(targets[g.id]!), unconfirmed: false } : { ...g, unconfirmed: false }));
  st.fundings = [
    { id: 'f1', goalId: 'goal-base', accountId: 'acc-kaspi', amount: tenge(100_000), date: TODAY, decisionId: null },
    { id: 'f2', goalId: 'goal-reserve', accountId: 'acc-kaspi', amount: tenge(150_000), date: TODAY, decisionId: null },
  ];
  st.lastBackupAt = TODAY;
  return st;
}

const STATES: Record<string, () => AppState> = {
  empty: () => emptyState(),
  imported: () => imported('synthetic.mmbackup'),
  configured,
  broken: () => imported('broken-balance.mmbackup'),
};

/** Экран → адрес; «income-result» дополнительно вводит сумму и сравнивает варианты. */
const SCREENS: [string, string][] = [
  ['overview', '#/overview'], ['setup', '#/setup'], ['goals', '#/goals'], ['income', '#/income'], ['income-result', '#/income'],
  ['forecast', '#/forecast'], ['import', '#/import'], ['classes', '#/classes'], ['settings', '#/settings'], ['calc', '#/settings/calc'],
];
const PLAN: [string, string[]][] = [
  ['configured', SCREENS.map(([n]) => n)],
  ['imported', ['overview', 'setup', 'import', 'classes', 'forecast']],
  ['empty', ['overview', 'setup', 'goals', 'forecast']],
  ['broken', ['overview', 'import', 'income', 'forecast']],
];
const VARIANTS = [
  { name: 'phone', viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, colorScheme: 'light' as const },
  { name: 'laptop', viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1, colorScheme: 'light' as const },
  { name: 'dark', viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, colorScheme: 'dark' as const },
];

async function put(page, json: string): Promise<void> {
  await page.evaluate(
    (v) =>
      new Promise<void>((res, rej) => {
        const r = indexedDB.open('capital-os', 1);
        r.onupgradeneeded = () => r.result.createObjectStore('kv');
        r.onsuccess = () => {
          const t = r.result.transaction('kv', 'readwrite');
          t.objectStore('kv').put(v, 'state');
          t.oncomplete = () => (r.result.close(), res());
          t.onerror = () => rej(t.error);
        };
        r.onerror = () => rej(r.error);
      }),
    json,
  );
}

const browser = await chromium.launch();
let n = 0;
for (const v of VARIANTS) {
  for (const [stateName, screens] of PLAN) {
    if (v.name !== 'phone' && stateName !== 'configured') continue; // доп. состояния — только на телефоне
    const ctx = await browser.newContext({ viewport: v.viewport, deviceScaleFactor: v.deviceScaleFactor, colorScheme: v.colorScheme });
    const page = await ctx.newPage();
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(`${BASE}/?today=${TODAY}`);
    await put(page, serializeState(STATES[stateName]!(), TODAY));
    for (const name of screens) {
      if (only && name !== only) continue;
      const hash = SCREENS.find(([s]) => s === name)![1];
      await page.goto(`${BASE}/?today=${TODAY}${hash}`);
      await page.reload();
      await page.waitForTimeout(400);
      if (name === 'income-result') {
        const amount = page.locator('input[name=amount]').first();
        await amount.fill('180000');
        await amount.press('Enter');
        await page.waitForTimeout(900);
      }
      await page.screenshot({ path: join(OUT, `${stateName}-${name}-${v.name}.png`), fullPage: true });
      n++;
    }
    if (errors.length) console.log(`${v.name}/${stateName}: ошибки страницы:`, errors);
    await ctx.close();
  }
}
await browser.close();
console.log(`${n} снимков → ${OUT}`);
