/**
 * Состояния и адреса экранов для снимков и автопроверок интерфейса (scripts/ui-shots.ts, scripts/ui-check.ts).
 * Состояния собираются движком — так снимки не зависят от того, как устроены формы.
 */
// @ts-nocheck — служебный модуль для Bun
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  autoLabelCategories, emptyState, importMmbackup, mergeAccountSettings, setCategoryClass, exampleGoals, detectInstallments,
  suggestionToObligation, remainingFromTerm, tenge, type AppState,
} from '../engine/index';

const ROOT = join(import.meta.dir, '..');
export const BASE = process.env.UI_URL ?? 'http://localhost:5199';
export const TODAY = '2026-10-28';

const fixture = (name: string) => new Uint8Array(readFileSync(join(ROOT, 'tests/fixtures', name)));

function imported(file: string): AppState {
  const data = importMmbackup(fixture(file));
  const s = emptyState();
  // как настоящий импорт (D96): категории без правила размечаются сами по названию
  return { ...s, imported: data, importedAt: TODAY, settings: { ...s.settings, classification: autoLabelCategories(s.settings.classification, data).settings, accounts: mergeAccountSettings([], data.accounts) } };
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
  const targets: Record<string, number> = { 'goal-trip': 600_000, 'goal-trip-tickets': 400_000, 'goal-trip-stay': 200_000, 'goal-repair': 150_000 };
  st.goals = exampleGoals(TODAY).map((g) => (targets[g.id] ? { ...g, targetMin: tenge(targets[g.id]!), unconfirmed: false } : { ...g, unconfirmed: false }));
  st.fundings = [
    { id: 'f1', goalId: 'goal-savings', accountId: 'acc-kaspi', amount: tenge(100_000), date: TODAY, decisionId: null },
    { id: 'f2', goalId: 'goal-reserve', accountId: 'acc-kaspi', amount: tenge(150_000), date: TODAY, decisionId: null },
  ];
  st.lastBackupAt = TODAY;
  // новая модель (D96): Halyk — копилка, первая настройка пройдена, одно «Отложил» без перевода
  st.settings.accounts = st.settings.accounts.map((a) => (a.accountId === 'acc-halyk' ? { ...a, kind: 'savings' } : a));
  st.settings.firstRunDone = true;
  st.goals.push({ ...st.goals.find((g) => g.id === 'goal-savings')!, id: 'goal-laptop', title: 'Ноутбук', targetMin: tenge(350_000), deadline: '2027-03-01', order: 20, history: [] });
  st.fundings.push({ id: 'f3', goalId: 'goal-trip-tickets', accountId: 'acc-kaspi', amount: tenge(20_000), date: '2026-10-21', decisionId: 'd0', pending: true });
  return st;
}

function broken(): AppState {
  const st = imported('broken-balance.mmbackup');
  st.settings.firstRunDone = true;
  return st;
}

export const STATES: Record<string, () => AppState> = {
  empty: () => emptyState(),
  imported: () => imported('synthetic.mmbackup'),
  configured,
  broken,
};

/** Экран → адрес; «income-result» дополнительно вводит сумму и сравнивает варианты. */
export const SCREENS: [string, string][] = [
  ['overview', '#/overview'], ['setup', '#/setup'], ['goals', '#/goals'], ['income', '#/income'], ['income-result', '#/income-more'],
  ['forecast', '#/forecast'], ['import', '#/import'], ['classes', '#/classes'], ['settings', '#/settings'], ['calc', '#/settings/calc'],
  ['more', '#/more'], ['markup', '#/markup'], ['accounts', '#/accounts'], ['incomes', '#/incomes'], ['debts', '#/debts'],
  ['setup-classes', '#/setup/classes'], ['setup-income', '#/setup/income'], ['setup-obligations', '#/setup/obligations'], ['setup-goals', '#/setup/goals'],
  ['explain-overview', '#/overview~explain/overview'], ['help', '#/help'], ['data', '#/data'], ['prefs', '#/prefs'],
  ['fc-scenarios', '#/forecast~fc-scenarios'], ['fc-goal', '#/forecast~fc-goal/goal-trip'],
  ['goal-new', '#/goals~goal-new'], ['goal-sheet', '#/goals~goal/goal-trip'], ['goal-fund', '#/goals~goal-fund/goal-trip'], ['goal-edit', '#/goals~goal-edit/goal-trip'],
  ['fc-events', '#/forecast~fc-events'], ['fc-whatif', '#/forecast~fc-whatif'], ['fc-whatif-result', '#/forecast~fc-whatif'],
  ['backup', '#/backup'], ['install', '#/install'], ['rare', '#/rare'], ['advanced', '#/advanced'], ['adv-rules', '#/advanced/rules'], ['adv-params', '#/advanced/params'], ['adv-scenarios', '#/advanced/scenarios'],
  ['account-sheet', '#/accounts~account/acc-kaspi'], ['savings', '#/accounts/savings'], ['rare-manual', '#/rare/manual'], ['income-kinds', '#/incomes~income-kinds'],
  ['income-more', '#/income-more'], ['forecast-more', '#/forecast-more'], ['start', '#/start'], ['start-savings', '#/start/savings'], ['start-goals', '#/start/goals'],
  ['baskets', '#/baskets'], ['basket-sheet', '#/baskets~basket/cat-food'], ['cushion', '#/goals~cushion'], ['distribute', '#/goals~distribute'], ['folder-sheet', '#/goals~goal/goal-trip'],
  ['plan-job', '#/forecast~plan/job'], ['plan-own', '#/forecast~plan/own'], ['setaside-other', '#/income~setaside-other'], ['arrived-pick', '#/income~arrived-pick'], ['goal-laptop', '#/goals~goal/goal-laptop'],
];
export async function put(page, json: string): Promise<void> {
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

