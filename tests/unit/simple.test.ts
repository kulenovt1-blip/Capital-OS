/**
 * Новый первый слой (D96): стратегия «По порядку», перенос старых данных, «Можно тратить», «Пришли деньги»,
 * «Отложил» с переводом на копилку, новые доходы, автоматическая разметка, вердикты целей, запас прочности.
 */
import { describe, it, expect } from 'vitest';
import { ladder, DEFAULT_STRATEGY_SETTINGS } from '../../engine/ladder';
import { buildOverview } from '../../engine/overview';
import { emptyState, parseState, serializeState, migrateToSimple, type AppState } from '../../engine/state';
import { importMmbackup } from '../../engine/import/mmbackup';
import { classifyAll, setCategoryClass } from '../../engine/classify';
import { createGoal, resolveGoalTargets, type Goal } from '../../engine/goals';
import { makeInstallment } from '../../engine/obligations';
import { mergeAccountSettings, accountKindOf } from '../../engine/settings';
import { tenge, type Money } from '../../engine/money';
import {
  arrivedIncomes, autoLabelCategories, basketClass, detectNewIncomes, goalVerdicts, reorderGoals, runway,
  setAsideReminders, settleSetAsides, splitIncome,
} from '../../engine/simple';
import { fixtureBytes } from '../support/fixtures';
import { g as wg, TODAY as WT } from '../support/world';

const TODAY = '2026-10-28';

function goal(id: string, extra: Partial<Goal> = {}): Goal {
  const r = createGoal({ id, title: id, role: 'capital', targetMin: tenge(100_000), importance: 3 }, [], TODAY);
  if (!r.ok) throw new Error(r.error);
  return { ...r.value, ...extra };
}

function state(extra: Partial<AppState> = {}): AppState {
  const data = importMmbackup(fixtureBytes('synthetic.mmbackup'));
  const s = emptyState();
  let cls = s.settings.classification;
  const cat = (id: string) => data.categories.find((c) => c.id === id)!;
  cls = setCategoryClass(cls, cat('cat-food'), 'E_base', 'expense');
  cls = setCategoryClass(cls, cat('cat-fun'), 'E_fun', 'expense');
  cls = setCategoryClass(cls, cat('cat-salary'), 'I_work', 'income');
  const accounts = mergeAccountSettings([], data.accounts).map((a) => (a.accountId === 'acc-halyk' ? { ...a, kind: 'savings' as const } : a));
  return {
    ...s,
    imported: data,
    importedAt: TODAY,
    settings: { ...s.settings, classification: cls, accounts, incomeSchedule: [{ id: 'sal', title: 'Зарплата', dayOfMonth: 5, amount: tenge(180_000), kind: 'work' }] },
    obligations: [makeInstallment({ id: 'ob1', title: 'Телефон', owner: 'self', remaining: tenge(60_570), remainingAsOf: TODAY, payment: tenge(30_285), firstDate: '2026-11-05' })],
    goals: [goal('reserve', { role: 'safety', targetMin: tenge(50_000), order: 0 }), goal('trip', { deadline: '2027-07-01', targetMin: tenge(200_000), order: 10 }), goal('books', { targetMin: tenge(30_000), order: 20 })],
    ...extra,
  };
}

describe('стратегия «По порядку» (S)', () => {
  const run = (goals: Goal[], amount: number, progress: Record<string, number> = {}) =>
    ladder({ amount: tenge(amount), today: WT, goals, progress: new Map(Object.entries(progress).map(([k, v]) => [k, tenge(v)])), fundedThisMonth: new Map(), strategy: { id: 'S' }, settings: DEFAULT_STRATEGY_SETTINGS });

  it('подушка → цели со сроком (сколько нужно) → цели без срока по порядку; остаток свободен', () => {
    const goals = [
      wg({ id: 'cushion', role: 'safety', targetMin: tenge(100_000), order: 0 }),
      wg({ id: 'late', targetMin: tenge(120_000), deadline: '2027-11-05', order: 10 }),
      wg({ id: 'b', targetMin: tenge(30_000), order: 30 }),
      wg({ id: 'a', targetMin: tenge(20_000), order: 20 }),
    ];
    const r = run(goals, 200_000, { cushion: 90_000 });
    // подушка 10 000; «late» 120 000 / 12 мес = 10 000; «a» раньше «b» по порядку: 20 000, потом «b» 30 000
    expect(r.byGoal).toEqual({ a: tenge(20_000), b: tenge(30_000), cushion: tenge(10_000), late: tenge(10_000) });
    expect(r.free).toBe(tenge(130_000));
  });

  it('не хватает — первая по порядку цель без срока получает всё, следующая ждёт', () => {
    const goals = [wg({ id: 'x', targetMin: tenge(50_000), order: 20 }), wg({ id: 'y', targetMin: tenge(50_000), order: 10 })];
    expect(run(goals, 30_000).byGoal).toEqual({ y: tenge(30_000) });
  });

  it('папка «делить поровну» — поровну между целями внутри, с потолком', () => {
    const goals = [
      wg({ id: 'f', targetMin: tenge(0), folder: true, splitEqually: true, order: 10 }),
      wg({ id: 'f1', parentId: 'f', targetMin: tenge(10_000), order: 10 }),
      wg({ id: 'f2', parentId: 'f', targetMin: tenge(100_000), order: 20 }),
    ];
    const r = run(goals, 60_000);
    expect(r.byGoal).toEqual({ f1: tenge(10_000), f2: tenge(50_000) });
  });

  it('пустая папка пропускается молча', () => {
    const r = run([wg({ id: 'f', targetMin: tenge(0), folder: true })], 10_000);
    expect(r.explanation.some((s) => s.code === 'ladder.skip_unconfirmed')).toBe(false);
  });

  it('перетаскивание: порядок 10, 20, …', () => {
    const goals = [goal('a'), goal('b'), goal('c')];
    expect(reorderGoals(goals, ['c', 'a', 'b']).map((x) => [x.id, x.order])).toEqual([['a', 20], ['b', 30], ['c', 10]]);
  });
});

describe('перенос старых данных (один раз)', () => {
  function legacy(): AppState {
    const s = state();
    const parent = goal('trip', { importance: 4 });
    return {
      ...s,
      settings: { ...s.settings, simpleMigrated: false, planStrategy: 'B', accounts: s.settings.accounts.map((a) => ({ ...a, kind: undefined, ...(a.accountId === 'acc-cash' ? { boundGoalId: 'reserve' } : {}) })) },
      goals: [goal('reserve', { role: 'safety', targetMin: tenge(0), targetRule: { kind: 'months_of_base' }, importance: 5, targetComfort: tenge(10) }), parent, goal('tickets', { parentId: 'trip' })],
    };
  }

  it('счета, папки, порядок, подушка, комфортная сумма, стратегия', () => {
    const s = legacy();
    migrateToSimple(s);
    const kind = Object.fromEntries(s.settings.accounts.map((a) => [a.accountId, a.kind]));
    expect(kind['acc-cash']).toBe('savings'); // привязан к цели
    expect(kind['acc-kaspi']).toBe('spend');
    const byId = new Map(s.goals.map((x) => [x.id, x]));
    expect(byId.get('trip')!.folder).toBe(true);
    expect(byId.get('reserve')!.targetRule).toEqual({ kind: 'months_of_base', basis: 'essential' });
    expect(byId.get('reserve')!.targetComfort).toBeUndefined();
    expect(byId.get('reserve')!.order).toBe(0);
    expect(byId.get('trip')!.order).toBe(10);
    expect(s.settings.planStrategy).toBe('S');
    expect(s.settings.simpleMigrated).toBe(true);
  });

  it('старый бэкап переносится при чтении, новый — нет; повторное чтение ничего не меняет', () => {
    const s = legacy();
    const json = serializeState(s, TODAY).replace('"simpleMigrated": false', '"x": 1');
    const r = parseState(json);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.settings.planStrategy).toBe('S');
    const again = parseState(serializeState(r.value, TODAY));
    expect(again.ok && serializeState(again.value, TODAY)).toBe(serializeState(r.value, TODAY));
    // новый человек: планы не трогаются
    const fresh = emptyState();
    fresh.settings.planStrategy = 'B';
    const p = parseState(serializeState(fresh, TODAY));
    expect(p.ok && p.value.settings.planStrategy).toBe('B');
  });

  it('вид счёта по умолчанию: заданный, привязанный, не «сразу» — копилка; иначе для трат', () => {
    const pos = (id: string, liquidity: { kind: 'instant' } | { kind: 'days'; days: number } = { kind: 'instant' }) => ({ accountId: id, source: 'moneymanager', liquidity });
    expect(accountKindOf(pos('a'), [])).toBe('spend');
    expect(accountKindOf(pos('a', { kind: 'days', days: 3 }), [])).toBe('savings');
    expect(accountKindOf(pos('a'), [{ accountId: 'a', excluded: false, liquidity: { kind: 'instant' }, kind: 'savings' }])).toBe('savings');
  });
});

describe('«Можно тратить» и «На руках»', () => {
  it('копилки не входят; отложенное и платежи до дохода вычитаются', () => {
    const s = state();
    const o = buildOverview(s, TODAY);
    const sp = o.spend;
    const spendIds = Object.entries(sp.kinds).filter(([, k]) => k === 'spend').map(([id]) => id);
    const bal = (id: string) => o.capital.accounts.find((p) => p.accountId === id)!.balance;
    expect(sp.spendNow).toBe(spendIds.reduce((a, id) => a + bal(id), 0));
    const savingsIds = Object.entries(sp.kinds).filter(([, k]) => k === 'savings').map(([id]) => id);
    expect(savingsIds).toContain('acc-halyk');
    expect(sp.inSavings).toBe(savingsIds.reduce((a, id) => a + bal(id), 0));
    expect(sp.canSpend).toBe(sp.spendNow - sp.setAsideOnSpend - o.reserveUntilIncome);
    expect(sp.onHand).toBe(o.capital.accounts.filter((p) => !p.excluded).reduce((a, p) => a + p.balance, 0));
    // отложил 10 000 на Kaspi → можно тратить меньше на 10 000
    const s2 = { ...s, fundings: [{ id: 'f1', goalId: 'books', accountId: 'acc-kaspi', amount: tenge(10_000), date: TODAY, decisionId: null, pending: true as const }] };
    expect(buildOverview(s2, TODAY).spend.canSpend).toBe(sp.canSpend - tenge(10_000));
  });

  it('подушка «обязательное + жизнь» и «все обычные траты»', () => {
    const base = tenge(100_000);
    const goals = [goal('c', { role: 'safety', targetMin: tenge(0), targetRule: { kind: 'months_of_base', months: 3, basis: 'all' } })];
    expect(resolveGoalTargets(goals, base, 3, { essential: tenge(120_000), all: tenge(150_000) }).goals[0]!.targetMin).toBe(tenge(450_000));
    goals[0]!.targetRule = { kind: 'months_of_base', months: 2, basis: 'essential' };
    expect(resolveGoalTargets(goals, base, 3, { essential: tenge(120_000), all: tenge(150_000) }).goals[0]!.targetMin).toBe(tenge(240_000));
    // без basis — как раньше, по базовым тратам
    goals[0]!.targetRule = { kind: 'months_of_base', months: 2 };
    expect(resolveGoalTargets(goals, base, 3, { essential: tenge(1), all: tenge(1) }).goals[0]!.targetMin).toBe(tenge(200_000));
  });
});

describe('«Пришли деньги»', () => {
  it('поступления после последнего распределения — только на счета для трат, без кэшбэка', () => {
    const s = state();
    const a = arrivedIncomes(s, TODAY);
    expect(a.length).toBeGreaterThan(0);
    expect(a.every((x) => x.accountId === 'acc-kaspi')).toBe(true);
    expect(a[0]!.date >= a[a.length - 1]!.date).toBe(true);
    const later = { ...s, decisions: [{ id: 'd', date: '2026-10-21', type: 'allocation' as const, input: {}, chosenStrategy: null, alternatives: [], explanation: [], userNote: '' }] };
    expect(arrivedIncomes(later, TODAY).every((x) => x.date > '2026-10-21')).toBe(true);
  });

  it('отложить + на жизнь = можно тратить сейчас; строки по целям в порядке списка', () => {
    const s = state();
    const sp = splitIncome(s, TODAY, tenge(180_000), true);
    const o = buildOverview(s, TODAY);
    expect(sp.setAside + sp.life).toBe(o.spend.canSpend);
    expect(sp.lines.map((l) => l.goalId).filter((id) => ['reserve', 'trip', 'books'].includes(id))).toEqual(['reserve', 'trip', 'books'].filter((id) => sp.lines.some((l) => l.goalId === id)));
    expect(sp.setAside).toBe(sp.lines.reduce((a, l) => a + l.amount, 0));
  });
});

describe('«Отложил» → перевод на копилку', () => {
  const withTransfer = (s: AppState, amount: number): AppState => ({
    ...s,
    imported: { ...s.imported!, operations: [...s.imported!.operations, { kind: 'transfer', id: 'tr-x', date: '2026-10-25', fromAccountId: 'acc-kaspi', toAccountId: 'acc-halyk', fromAmount: tenge(amount), toAmount: tenge(amount), comment: '' }] },
  });
  const pending = (id: string, goalId: string, amount: number) => ({ id, goalId, accountId: 'acc-kaspi', amount: tenge(amount), date: '2026-10-21', decisionId: 'd1', pending: true as const });

  it('перевод найден — метки переезжают на копилку, напоминания нет; повторный импорт не двигает дважды', () => {
    const s = withTransfer({ ...state(), fundings: [pending('p1', 'trip', 20_000), pending('p2', 'books', 15_000)] }, 25_000);
    const r = settleSetAsides(s, TODAY);
    expect(r.moved).toBe(tenge(25_000));
    const net = (acc: string, gid: string) => r.state.fundings.filter((f) => f.accountId === acc && f.goalId === gid).reduce((a, f) => a + f.amount, 0);
    expect([net('acc-kaspi', 'trip'), net('acc-halyk', 'trip'), net('acc-kaspi', 'books'), net('acc-halyk', 'books')]).toEqual([0, tenge(20_000), tenge(10_000), tenge(5_000)]);
    expect(settleSetAsides(r.state, TODAY).moved).toBe(0);
    // осталось 10 000 на Kaspi, бэкап новее — напоминание
    const rem = setAsideReminders(r.state, buildOverview(r.state, TODAY));
    expect(rem.map((x) => [x.accountId, x.amount])).toEqual([['acc-kaspi', tenge(10_000)]]);
  });

  it('перевода нет — напоминание; бэкап не новее даты «Отложил» — ещё рано', () => {
    const s = { ...state(), fundings: [pending('p1', 'trip', 20_000)] };
    expect(setAsideReminders(s, buildOverview(s, TODAY)).map((x) => x.amount)).toEqual([tenge(20_000)]);
    // прежние метки на том же счёте (до новой модели) в напоминание не попадают
    const legacy = { ...s, fundings: [...s.fundings, { id: 'old', goalId: 'books', accountId: 'acc-kaspi', amount: tenge(100_000), date: '2026-09-01', decisionId: null }] };
    expect(setAsideReminders(legacy, buildOverview(legacy, TODAY)).map((x) => x.amount)).toEqual([tenge(20_000)]);
    const early = { ...s, fundings: [{ ...pending('p1', 'trip', 20_000), date: '2026-10-28' }] };
    expect(setAsideReminders(early, buildOverview(early, TODAY))).toEqual([]);
  });
});

describe('новые доходы и разметка', () => {
  it('зарплата уже заведена — не предлагается; стипендия не заведена — предлагается; «это не доход» — скрыта', () => {
    const s = state();
    const cls = setCategoryClass(s.settings.classification, s.imported!.categories.find((c) => c.id === 'cat-stipend')!, 'I_stipend', 'income');
    const s2 = { ...s, settings: { ...s.settings, classification: cls } };
    const found = detectNewIncomes(s2, TODAY);
    expect(found.map((x) => [x.title, x.amount, x.dayOfMonth])).toEqual([['Стипендия', tenge(38_000), 10]]);
    const s3 = { ...s2, settings: { ...s2.settings, dismissedIncomes: ['cat-stipend'] } };
    expect(detectNewIncomes(s3, TODAY)).toEqual([]);
  });

  it('категории без правила размечаются сами (по названию, иначе «прочее»), с пометкой auto', () => {
    const s = emptyState();
    const data = importMmbackup(fixtureBytes('synthetic.mmbackup'));
    const r = autoLabelCategories(s.settings.classification, data);
    expect(r.added).toBeGreaterThan(0);
    expect(classifyAll(data, r.settings).complete).toBe(true);
    const rule = (id: string) => r.settings.rules.find((x) => x.categoryId === id);
    expect(rule('cat-food')).toMatchObject({ class: 'E_base', auto: true });
    expect(rule('cat-fee')).toMatchObject({ class: 'E_other', auto: true });
    expect(rule('cat-salary')).toMatchObject({ class: 'I_work', auto: true });
    // правила по умолчанию (D13) не перезаписываются
    expect(rule('cat-installment')).toBeUndefined();
    expect(autoLabelCategories(r.settings, data).added).toBe(0);
  });

  it('корзина «Разовое» — свой класс, создаётся один раз', () => {
    const s = emptyState();
    const a = basketClass('oneoff', s.settings.classes);
    expect(a.classes.custom.map((c) => [c.label, c.behavior])).toEqual([['Разовое', 'irregular']]);
    expect(basketClass('oneoff', a.classes).classes.custom.length).toBe(1);
    expect(basketClass('everyday', s.settings.classes).cls).toBe('E_base');
  });
});

describe('вердикты целей и запас прочности', () => {
  it('цель со сроком: успеваешь — откладывай осталось ÷ месяцев; без срока — без вердикта', () => {
    const s = state();
    const v = goalVerdicts(s, TODAY);
    expect(v.has('books')).toBe(false);
    const t = v.get('trip')!;
    expect(t.remaining).toBe(tenge(200_000));
    expect(t.perMonth).toBe(Math.round(tenge(200_000) / 9) as Money);
    // огромная цель к близкому сроку — не успеваешь, нужно ещё > 0
    const big = { ...s, goals: [...s.goals, goal('car', { deadline: '2026-12-31', targetMin: tenge(50_000_000), order: 5 })] };
    const c = goalVerdicts(big, TODAY).get('car')!;
    expect(c.ok).toBe(false);
    expect(c.extraPerMonth).toBeGreaterThan(0);
  });

  it('без доходов деньги кончаются — запас прочности в месяцах', () => {
    const r = runway(state(), TODAY);
    expect(r).not.toBeNull();
    expect(r!.months).toBeGreaterThanOrEqual(0);
    expect(r!.until > TODAY).toBe(true);
  });
});
