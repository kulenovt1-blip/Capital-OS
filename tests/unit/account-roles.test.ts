/**
 * Настройки вместо догадок (DECISIONS D58–D62):
 *  1) вопрос о счетах «не учитывать в балансе»; 2) «весь баланс счёта — за целью»;
 *  3) долги на начало учёта и запрет отрицательного долга в капитале; 4) куда уходили переводы «Накопительный счёт»;
 *  5) счёт без названия.
 * Ожидания записаны до реализации.
 */
import { describe, it, expect } from 'vitest';
import { computeCapital, type CapitalInput } from '../../engine/ledger';
import { classifyAll, DEFAULT_CLASSIFICATION } from '../../engine/classify';
import { accountsNeedingReview, mergeAccountSettings, DEFAULT_SETTINGS, type AccountSettings } from '../../engine/settings';
import { buildOverview } from '../../engine/overview';
import { buildGoalsView } from '../../engine/goals-view';
import { assignMoney, createGoal, effectiveFundings, type Goal } from '../../engine/goals';
import { accountDisplayTitle } from '../../engine/import/mmbackup';
import { emptyState, parseState, serializeState, type AppState } from '../../engine/state';
import { tenge } from '../../engine/money';
import { acc, cat, dataset, exp, inc, trf } from '../support/build';

const TODAY = '2026-10-28';

function goal(id: string, extra: Partial<Goal> = {}): Goal {
  const r = createGoal({ id, title: id, role: 'safety', targetMin: tenge(1_000_000), importance: 5 }, [], TODAY);
  if (!r.ok) throw new Error(r.error);
  return { ...r.value, ...extra };
}

const cats = [cat('c-repay', 'Возвращаю долг'), cat('c-lent-back', 'Возвращают долг', 'income'), cat('c-save', 'Накопительный счёт'), cat('c-save-in', 'Накопление', 'income')];

function state(extra: Partial<AppState> = {}): AppState {
  const accounts = [acc('card', 'Kaspi'), acc('stash', 'Заначка', { ignoreInBalance: true }), acc('tech', 'Технический', { ignoreInBalance: true })];
  const data = dataset({
    accounts,
    categories: cats,
    operations: [
      inc('2026-01-01', 'card', 300_000, null),
      trf('2026-02-01', 'card', 'stash', 100_000),
      exp('2026-03-01', 'card', 13_000, 'c-repay'), // долг взят до начала учёта
      inc('2026-03-02', 'card', 2_773, 'c-lent-back'), // долг выдан до начала учёта
      exp('2026-04-01', 'card', 40_000, 'c-save'), // откладывал расходом «Накопительный счёт»
    ],
  });
  const s = emptyState();
  return { ...s, imported: data, importedAt: TODAY, settings: { ...s.settings, accounts: mergeAccountSettings([], data.accounts) }, ...extra };
}

describe('1. счета с флагом «не учитывать в балансе» — вопрос, а не молчаливое исключение', () => {
  it('такие счета исключены до ответа и попадают в список «ждут решения»', () => {
    const st = state();
    expect(accountsNeedingReview(st.settings.accounts, st.imported!.accounts).map((a) => a.id)).toEqual(['stash', 'tech']);
    const o = buildOverview(st, TODAY);
    expect(o.notices.some((n) => n.code === 'accounts.review')).toBe(true);
  });

  it('после ответа счёт больше не спрашивается; «отложенные деньги» входят в капитал', () => {
    const st = state();
    st.settings.accounts = st.settings.accounts.map((s): AccountSettings => (s.accountId === 'stash' ? { ...s, excluded: false, reviewed: true } : s.accountId === 'tech' ? { ...s, reviewed: true } : s));
    expect(accountsNeedingReview(st.settings.accounts, st.imported!.accounts)).toEqual([]);
    const o = buildOverview(st, TODAY);
    expect(o.capital.accounts.find((p) => p.accountId === 'stash')!.excluded).toBe(false);
    expect(o.notices.some((n) => n.code === 'accounts.review')).toBe(false);
  });

  it('повторный импорт не спрашивает заново про уже решённые счета', () => {
    const decided: AccountSettings[] = [{ accountId: 'stash', excluded: false, liquidity: { kind: 'instant' }, reviewed: true }];
    const merged = mergeAccountSettings(decided, state().imported!.accounts);
    expect(merged.find((s) => s.accountId === 'stash')).toMatchObject({ excluded: false, reviewed: true });
  });
});

describe('2. «весь баланс счёта — за целью»', () => {
  function bound(): AppState {
    const st = state({ goals: [goal('reserve'), goal('other', { role: 'capital', importance: 3 })] });
    st.settings.accounts = st.settings.accounts.map((s) => (s.accountId === 'stash' ? { ...s, excluded: false, reviewed: true, boundGoalId: 'reserve' } : s));
    st.settings.savingsFlows = { mode: 'ignore' }; // без оценки сбережений — тест только про привязку
    return st;
  }

  it('баланс счёта назначен цели автоматически: не входит в «свободно», но входит в капитал и ликвидность', () => {
    const o = buildOverview(bound(), TODAY);
    expect(o.capital.liquidNow).toBe(tenge(300_000 - 13_000 + 2_773 - 40_000));
    expect(o.assigned).toBe(tenge(100_000));
    expect(o.freeMoney).toBe(o.capital.liquidNow - tenge(100_000) - o.reserveUntilIncome);
    expect(buildGoalsView(bound(), TODAY).tree.find((n) => n.goal.id === 'reserve')!.progress).toBe(tenge(100_000));
  });

  it('явное назначение на этом счёте учитывается, привязка берёт только остаток', () => {
    const st = bound();
    st.fundings = [{ id: 'f', goalId: 'other', accountId: 'stash', amount: tenge(30_000), date: TODAY, decisionId: null }];
    const o = buildOverview(st, TODAY);
    const eff = effectiveFundings(st.fundings, o.capital.accounts, st.settings.accounts, st.goals);
    expect(eff.filter((f) => f.accountId === 'stash').map((f) => [f.goalId, f.amount])).toEqual([['other', tenge(30_000)], ['reserve', tenge(70_000)]]);
    expect(o.overAssigned).toEqual([]);
  });

  it('на привязанном счёте свободных денег нет — назначить вручную нельзя', () => {
    const st = bound();
    const v = buildGoalsView(st, TODAY);
    const r = assignMoney({ id: 'x', goalId: 'other', accountId: 'stash', amount: tenge(1), date: TODAY, decisionId: null }, { goals: v.goals, fundings: v.fundings, balances: v.balances });
    expect(r.ok).toBe(false);
  });

  it('привязка к отменённой или удалённой цели не действует и даёт предупреждение', () => {
    const st = bound();
    st.goals = st.goals.map((g) => (g.id === 'reserve' ? { ...g, status: 'cancelled' as const } : g));
    const o = buildOverview(st, TODAY);
    expect(o.assigned).toBe(tenge(0));
    expect(o.notices.some((n) => n.code === 'accounts.bound_invalid')).toBe(true);
  });
});

describe('3. долги на начало учёта; отрицательный долг не попадает в капитал', () => {
  const inp = (st: AppState): CapitalInput => ({
    data: st.imported!,
    classified: classifyAll(st.imported!, DEFAULT_CLASSIFICATION).ops,
    accountSettings: st.settings.accounts,
    manualAccounts: [],
    adjustments: [],
    obligations: [],
    today: TODAY,
    openingDebts: st.settings.openingDebts,
    savingsFlows: { mode: 'ignore' },
  });

  it('по операциям «должен −13 000» → в обязательствах 0, нетто не завышено, предупреждение с исходной цифрой', () => {
    const r = computeCapital(inp(state()));
    expect(r.liabilities.payablesFromOps).toBe(tenge(0));
    expect(r.receivables).toBe(tenge(0));
    expect(r.net).toBe(r.gross);
    const warn = r.explanation.filter((s) => s.level === 'warn').map((s) => s.text).join('\n');
    expect(warn).toMatch(/−13\s000/);
    expect(warn).toMatch(/на начало учёта/);
  });

  it('с долгами на начало учёта числа сходятся и предупреждений нет', () => {
    const st = state();
    st.settings.openingDebts = { payable: tenge(13_000), receivable: tenge(5_000) };
    const r = computeCapital(inp(st));
    expect(r.liabilities.payablesFromOps).toBe(tenge(0)); // 13 000 − 13 000
    expect(r.receivables).toBe(tenge(5_000 - 2_773));
    expect(r.explanation.some((s) => s.code === 'capital.payables_negative' || s.code === 'capital.receivables_negative')).toBe(false);
  });

  it('по умолчанию долги на начало учёта — 0; поле проходит через JSON-бэкап и проверку денег', () => {
    expect(DEFAULT_SETTINGS.openingDebts).toEqual({ payable: tenge(0), receivable: tenge(0) });
    const st = state();
    st.settings.openingDebts = { payable: tenge(13_000), receivable: tenge(0) };
    const back = parseState(serializeState(st, TODAY));
    expect(back.ok && back.value.settings.openingDebts.payable).toBe(tenge(13_000));
    const raw = JSON.parse(serializeState(st, TODAY));
    raw.state.settings.openingDebts.payable = 0.5;
    expect(parseState(JSON.stringify(raw)).ok).toBe(false);
  });
});

describe('4. куда уходили переводы «Накопительный счёт»', () => {
  it('«оценивать» (по умолчанию) — псевдосчёт по переводам', () => {
    const o = buildOverview(state(), TODAY);
    expect(o.capital.accounts.find((p) => p.source === 'savings_flow')!.balance).toBe(tenge(40_000));
  });

  it('«уже учтены в балансах счетов» — псевдосчёта нет, объяснение говорит почему', () => {
    const st = state();
    st.settings.savingsFlows = { mode: 'ignore' };
    const o = buildOverview(st, TODAY);
    expect(o.capital.accounts.some((p) => p.source === 'savings_flow')).toBe(false);
    expect(o.capital.explanation.some((s) => s.code === 'capital.savings_ignored')).toBe(true);
  });

  it('«в ручной счёт» — переводы после даты остатка прибавляются к выбранному ручному счёту', () => {
    const st = state();
    st.manualAccounts = [{ id: 'm', title: 'Депозит Halyk', balance: tenge(500_000), balanceDate: '2026-03-15', liquidity: { kind: 'instant' }, comment: '' }];
    st.settings.savingsFlows = { mode: 'manual', manualAccountId: 'm' };
    const o = buildOverview(st, TODAY);
    expect(o.capital.accounts.find((p) => p.accountId === 'm')!.balance).toBe(tenge(540_000));
    expect(o.capital.accounts.some((p) => p.source === 'savings_flow')).toBe(false);
  });

  it('старый флаг ручного счёта «принимает сбережения» продолжает работать', () => {
    const st = state();
    st.manualAccounts = [{ id: 'm', title: 'Депозит', balance: tenge(500_000), balanceDate: '2026-03-15', liquidity: { kind: 'instant' }, comment: '', receivesSavingsFlows: true }];
    expect(buildOverview(st, TODAY).capital.accounts.find((p) => p.accountId === 'm')!.balance).toBe(tenge(540_000));
  });

  it('старый бэкап без новых настроек читается с умолчаниями', () => {
    const raw = JSON.parse(serializeState(state(), TODAY));
    delete raw.state.settings.savingsFlows;
    delete raw.state.settings.openingDebts;
    const back = parseState(JSON.stringify(raw));
    expect(back.ok && back.value.settings.savingsFlows).toEqual({ mode: 'estimate' });
  });
});

describe('5. счёт без названия', () => {
  it('пустое название показывается как «(без названия)» с хвостом id', () => {
    expect(accountDisplayTitle('', 'f3a9c1d2-77')).toBe('(без названия, f3a9c1)');
    expect(accountDisplayTitle('   ', 'abc')).toBe('(без названия, abc)');
    expect(accountDisplayTitle(' Kaspi ', 'x')).toBe('Kaspi');
  });
});

describe('2б. привязка счёта видна во всех проверках — не только в Обзоре', () => {
  const bound = (): AppState => {
    const st = state({ goals: [goal('reserve'), goal('base', { role: 'capital' })] });
    st.settings.accounts = st.settings.accounts.map((a) => (a.accountId === 'stash' ? { ...a, excluded: false, reviewed: true, boundGoalId: 'reserve' } : a));
    st.settings.incomeSchedule = [{ id: 'sal', title: 'Зарплата', dayOfMonth: 5, amount: tenge(200_000), kind: 'work' }];
    return st;
  };

  it('экран «Цели» отдаёт для проверок назначения с привязкой: заначку нельзя назначить второй раз', async () => {
    const st = bound();
    const v = buildGoalsView(st, TODAY);
    const r = assignMoney({ id: 'x', goalId: 'base', accountId: 'stash', amount: tenge(1), date: TODAY, decisionId: null }, { goals: v.goals, fundings: v.fundings, balances: v.balances });
    expect(r.ok).toBe(false);
  });

  it('шаг 0 не считает деньги привязанного счёта свободными', async () => {
    const { planIncome } = await import('../../engine/plan');
    const { makeInstallment } = await import('../../engine/obligations');
    // деньги на карте уже за целью, до зарплаты 05.11 — платёж 50 000: покрыть его может только заначка
    const st = bound();
    st.fundings = [{ id: 'f-card', goalId: 'base', accountId: 'card', amount: tenge(149_773), date: TODAY, decisionId: null }];
    st.obligations = [makeInstallment({ id: 'ob', title: 'Рассрочка', owner: 'self', remaining: tenge(50_000), remainingAsOf: TODAY, payment: tenge(50_000), firstDate: '2026-11-01' })];
    const withBinding = planIncome(st, TODAY, { amount: tenge(10_000), incomeInBalance: false, strategies: [{ id: 'B' }] });
    const noBinding = planIncome({ ...st, settings: { ...st.settings, accounts: st.settings.accounts.map((a) => (a.accountId === 'stash' ? { ...a, boundGoalId: undefined } : a)) } }, TODAY, { amount: tenge(10_000), incomeInBalance: false, strategies: [{ id: 'B' }] });
    // свободно без привязки: заначка 100 000 + оценка сбережений 40 000 → платёж 50 000 покрыт, доступно 10 000
    // с привязкой: только оценка сбережений 40 000 → не покрыто 10 000, доступно 10 000 − 10 000 = 0
    expect(noBinding.step0.available).toBe(tenge(10_000));
    expect(withBinding.step0.available).toBe(tenge(0));
    expect(withBinding.step0.R1uncovered).toBe(tenge(10_000));
  });

  it('выбор стратегии не ставит метки поверх привязанного счёта', async () => {
    const { planIncome, acceptAllocation } = await import('../../engine/plan');
    const st = bound();
    const c = planIncome(st, TODAY, { amount: tenge(50_000), incomeInBalance: false, strategies: [{ id: 'B' }] });
    expect(c.rows.length).toBeGreaterThan(0);
    const r = acceptAllocation(st, c, c.rows[0]!, 'stash', TODAY, 'dec', '');
    expect(r.ok).toBe(false);
    // и в сохранённые назначения виртуальные метки привязки не попадают
    const ok = acceptAllocation(st, c, c.rows[0]!, 'card', TODAY, 'dec', '');
    if (ok.ok) expect(ok.value.fundings.every((f) => !f.id.startsWith('bound:'))).toBe(true);
  });
});
