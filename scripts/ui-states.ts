/**
 * Состояния и адреса экранов для снимков и автопроверок интерфейса (scripts/ui-shots.ts, scripts/ui-check.ts).
 * Состояния собираются движком — так снимки не зависят от того, как устроены формы.
 */
// @ts-nocheck — служебный модуль для Bun
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  emptyState, importMmbackup, mergeAccountSettings, setCategoryClass, exampleGoals, detectInstallments,
  suggestionToObligation, remainingFromTerm, tenge, type AppState,
} from '../engine/index';

const ROOT = join(import.meta.dir, '..');
export const BASE = process.env.UI_URL ?? 'http://localhost:5199';
export const TODAY = '2026-10-28';

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

export const STATES: Record<string, () => AppState> = {
  empty: () => emptyState(),
  imported: () => imported('synthetic.mmbackup'),
  configured,
  broken: () => imported('broken-balance.mmbackup'),
};

/** Экран → адрес; «income-result» дополнительно вводит сумму и сравнивает варианты. */
export const SCREENS: [string, string][] = [
  ['overview', '#/overview'], ['setup', '#/setup'], ['goals', '#/goals'], ['income', '#/income'], ['income-result', '#/income'],
  ['forecast', '#/forecast'], ['import', '#/import'], ['classes', '#/classes'], ['settings', '#/settings'], ['calc', '#/settings/calc'],
  ['more', '#/more'], ['markup', '#/markup'], ['accounts', '#/accounts'], ['incomes', '#/incomes'], ['debts', '#/debts'],
  ['setup-classes', '#/setup/classes'], ['setup-income', '#/setup/income'], ['setup-obligations', '#/setup/obligations'], ['setup-goals', '#/setup/goals'],
  ['goal-new', '#/goals~goal-new'], ['goal-sheet', '#/goals~goal/goal-move'], ['goal-fund', '#/goals~goal-fund/goal-move'], ['goal-edit', '#/goals~goal-edit/goal-move'],
  ['fc-events', '#/forecast~fc-events'], ['fc-whatif', '#/forecast~fc-whatif'], ['fc-whatif-result', '#/forecast~fc-whatif'],
  ['backup', '#/backup'], ['install', '#/install'], ['rare', '#/rare'], ['advanced', '#/advanced'], ['adv-rules', '#/advanced/rules'], ['adv-params', '#/advanced/params'], ['adv-scenarios', '#/advanced/scenarios'],
  ['account-sheet', '#/accounts~account/acc-kaspi'], ['savings', '#/accounts/savings'], ['rare-manual', '#/rare/manual'], ['income-kinds', '#/incomes~income-kinds'],
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

