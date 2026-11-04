/**
 * Здравый смысл (D107) — главная и обязательная группа тестов.
 *
 * Модульные тесты проверяют, что формулы считают так, как задумано. Эти — что вывод можно принять на веру:
 * на реалистичном профиле человека модель не говорит абсурда («подушки не будет три года» при деньгах в 4,6 раза
 * больше подушки, «траты прежние» при падении дохода на треть).
 *
 * Как устроено:
 *  1. Профиль «как у живого человека» (обезличенный, суммы круглые): доход с датой окончания, работа закончилась,
 *     копилка целиком привязана к большой цели выше подушки, рассрочка, редкие траты — то, чего нет в synthetic.
 *  2. Храповик: множество ошибок (fail) на профиле должно совпадать с KNOWN_DEFECTS.
 *     - Появилась новая ошибка → тест падает: модель стала хуже.
 *     - Ошибка исчезла (исправили) → тест тоже падает: убери её из KNOWN_DEFECTS и запиши в DECISIONS.
 *     Список может только уменьшаться. Цель — пустой.
 *  3. Чистый профиль: проверки не дают ложных срабатываний.
 */
import { describe, it, expect } from 'vitest';
import { emptyState, type AppState } from '../../engine/state';
import { setCategoryClass } from '../../engine/classify';
import { mergeAccountSettings } from '../../engine/settings';
import { createGoal, type Goal } from '../../engine/goals';
import { makeInstallment } from '../../engine/obligations';
import { tenge } from '../../engine/money';
import { sanityCheck, sanityFails, type SanityId } from '../../engine/sanity';
import { liquidReachMonth, personStage } from '../../engine/stage';
import { savingOptions } from '../../engine/saving';
import { planToGoal } from '../../engine/route';
import { flattenTree } from '../../engine/goals';
import { routeTo, higherStages } from '../../engine/roadmap';
import { applyRepeatAnswer, cushionFill, cutEvent, reorderGoals, debtAfterYear, previewEvent, previewIndexed, baseForecast, capitalAt, previewBaselineMode, previewRepeat, sparseExpenses } from '../../engine/simple';
import { classRegistry } from '../../engine/classes';
import { buildOverview } from '../../engine/overview';
import { buildSimInput } from '../../engine/plan';
import { expensePart, raiseMonth } from '../../engine/hidden';
import type { OpClass } from '../../engine/classify';
import { acc, cat, dataset, exp, inc, trf } from '../support/build';

const TODAY = '2026-11-04';

/**
 * Известные ошибки модели (аудит №4, claude/audit-4-model-sanity.md). Исправил — убери строку. Цель — пусто.
 * Закрыты: К1 подушка (D108 — не ошибка, решение человека, warn), К2 и К3 (D108 — вопросы), К4 и С1 (D109).
 */
const KNOWN_DEFECTS: SanityId[] = [];
/** Вопросы, на которые человек ещё не ответил: пока нет ответа — вывод держится на допущении (D108, D109). */
const UNANSWERED_BASE: SanityId[] = ['income_drop_flat_spend', 'labels_exceed_money', 'one_sided_inflation'];
/** Профиль со всем, что прогноз раньше выбрасывал (live, D119): ещё четыре вопроса. */
const UNANSWERED: SanityId[] = [...UNANSWERED_BASE, 'income_omitted', 'installment_habit', 'interest_ignored', 'lumps_lost'];

function months(from: string, to: string): string[] {
  const out: string[] = [];
  let [y, m] = from.split('-').map(Number) as [number, number];
  for (;;) {
    const k = `${y}-${String(m).padStart(2, '0')}`;
    if (k > to) return out;
    out.push(k);
    m === 12 ? ((y += 1), (m = 1)) : (m += 1);
  }
}

function goal(id: string, extra: Partial<Goal>): Goal {
  const r = createGoal({ id, title: id, role: 'capital', targetMin: tenge(100_000), importance: 3 }, [], TODAY);
  if (!r.ok) throw new Error(r.error);
  return { ...r.value, ...extra };
}

interface ProfileOpts {
  /** Стипендия кончается (доход падает почти на треть). */
  incomeEnds?: boolean;
  /** Работа была в первой половине истории. */
  pastJob?: boolean;
  /** Редкие траты: подарки, одежда. */
  rare?: boolean;
  /** Копилка целиком за большой целью, цель выше подушки. */
  boundSavings?: boolean;
  /** Рассрочка. */
  installment?: boolean;
  inflationBp?: number;
  /** Первый месяц истории (по умолчанию 2025-09, 14 месяцев). */
  from?: string;
  /** Банк начисляет проценты на копилку (D119). */
  interest?: boolean;
  /** Крупные траты на семью несколько раз в год при маленьком обычном месяце (D119). */
  lumps?: boolean;
  /** Рассрочки платились весь год — привычка, а не разовая покупка (D119). */
  habit?: boolean;
  /** Подарки деньгами каждый месяц, не в расписании доходов (D119). */
  gifts?: boolean;
}

/** Обезличенный профиль: студент с пособием и стипендией, два месяца летней работы, карта ~20 тыс., копилка ~650 тыс. */
function profile(o: ProfileOpts = {}): AppState {
  const { incomeEnds = true, pastJob = true, rare = true, boundSavings = true, installment = true, interest = false, lumps = false, habit = false, gifts: giftIncome = false } = o;
  const cats = [cat('food', 'Продукты'), cat('fun', 'Развлечения'), cat('gifts', 'Подарки'), cat('clothes', 'Одежда'), cat('job', 'Зарплата', 'income'), cat('stip', 'Стипендия', 'income'), cat('ben', 'Пособие', 'income'), cat('phone', 'Телефон'), cat('pct', 'Проценты', 'income'), cat('fam', 'Семья'), cat('gift', 'Подарили', 'income')];
  const famLumps: Record<string, number> = lumps ? { '2025-12': 30_000, '2026-03': 30_000, '2026-08': 30_000 } : {};
  const first = o.from ?? '2025-09';
  const ops = [inc(`${first}-01`, 'card', 20_000, null)];
  const rareOps: Record<string, number> = rare ? { '2025-12': 40_000, '2026-03': 40_000, '2026-04': 30_000, '2026-07': 40_000, '2026-09': 30_000 } : {};
  let card = 20_000;
  for (const m of months(first, '2026-10')) {
    const job = pastJob && m >= '2026-07' && m <= '2026-08';
    const income = (job ? 150_000 : 0) + 40_000 + 50_000 + (giftIncome ? 10_000 : 0);
    if (job) ops.push(inc(`${m}-05`, 'card', 150_000, 'job'));
    if (giftIncome) ops.push(inc(`${m}-02`, 'card', 10_000, 'gift'));
    if (interest && m >= '2026-05') ops.push(inc(`${m}-28`, 'save', 5_000, 'pct'));
    ops.push(inc(`${m}-12`, 'card', 40_000, 'ben'), inc(`${m}-23`, 'card', 50_000, 'stip'));
    ops.push(exp(`${m}-03`, 'card', 10_000, 'food'), exp(`${m}-17`, 'card', 10_000, 'food'), exp(`${m}-20`, 'card', 10_000, 'fun'));
    let spent = 30_000;
    if (installment && m >= (habit ? '2025-11' : '2026-08')) (ops.push(exp(`${m}-17`, 'card', 25_000, 'phone')), (spent += 25_000));
    if (lumps) (ops.push(exp(`${m}-08`, 'card', 1_000 + (famLumps[m] ?? 0), 'fam')), (spent += 1_000 + (famLumps[m] ?? 0)));
    const r = rareOps[m];
    if (r) (ops.push(exp(`${m}-14`, 'card', r, m === '2026-04' || m === '2026-09' ? 'clothes' : 'gifts')), (spent += r));
    card += income - spent;
    // на карте остаётся ~20 тыс., остальное — в копилку (как у живого человека: копилка большая, карта маленькая)
    if (card > 20_000) (ops.push(trf(`${m}-25`, 'card', 'save', card - 20_000)), (card = 20_000));
  }
  const data = dataset({ accounts: [acc('card', 'Карта'), acc('save', 'Заначка')], categories: cats, operations: ops });

  const s = emptyState();
  const gifts = { id: 'U_E_gifts' as OpClass, label: 'Подарки', group: 'expense' as const, behavior: 'irregular' as const, builtin: false };
  const clothes = { id: 'U_E_clothes' as OpClass, label: 'Одежда', group: 'expense' as const, behavior: 'irregular' as const, builtin: false };
  let cls = s.settings.classification;
  const c = (id: string) => data.categories.find((x) => x.id === id)!;
  cls = setCategoryClass(cls, c('food'), 'E_base', 'expense');
  cls = setCategoryClass(cls, c('fun'), 'E_fun', 'expense');
  cls = setCategoryClass(cls, c('gifts'), gifts.id, 'expense');
  cls = setCategoryClass(cls, c('clothes'), clothes.id, 'expense');
  cls = setCategoryClass(cls, c('phone'), 'E_installment_own', 'expense');
  cls = setCategoryClass(cls, c('job'), 'I_work', 'income');
  cls = setCategoryClass(cls, c('stip'), 'I_stipend', 'income');
  cls = setCategoryClass(cls, c('ben'), 'I_benefit', 'income');
  cls = setCategoryClass(cls, c('pct'), 'I_interest', 'income');
  cls = setCategoryClass(cls, c('fam'), 'E_family', 'expense');
  cls = setCategoryClass(cls, c('gift'), 'I_gift', 'income');
  const accounts = mergeAccountSettings([], data.accounts).map((a) => (a.accountId === 'save' ? { ...a, kind: 'savings' as const, ...(boundSavings ? { boundGoalId: 'base' } : {}) } : { ...a, kind: 'spend' as const }));
  const cushion = goal('cushion', { title: 'Подушка', role: 'safety', targetMin: tenge(0), order: boundSavings ? 20 : 0, targetRule: { kind: 'months_of_base', months: 3, basis: 'essential' } });
  const base = goal('base', { title: 'База 1 млн', targetMin: tenge(1_000_000), order: boundSavings ? 10 : 30 });
  return {
    ...s,
    imported: data,
    importedAt: TODAY,
    settings: {
      ...s.settings,
      simpleMigrated: true,
      classification: cls,
      classes: { ...s.settings.classes, custom: [...s.settings.classes.custom, gifts, clothes] },
      accounts,
      inflationBp: o.inflationBp ?? s.settings.inflationBp,
      incomeSchedule: [
        { id: 'stip', title: 'Стипендия', dayOfMonth: 23, amount: tenge(50_000), kind: 'stable', ...(incomeEnds ? { end: '2027-06-25' } : {}) },
        { id: 'ben', title: 'Пособие', dayOfMonth: 12, amount: tenge(40_000), kind: 'stable' },
      ],
    },
    obligations: installment ? [makeInstallment({ id: 'ph', title: 'Телефон', owner: 'self', remaining: tenge(250_000), remainingAsOf: TODAY, payment: tenge(25_000), firstDate: '2026-11-17' })] : [],
    goals: [base, cushion],
    fundings: boundSavings ? [] : [{ id: 'f1', goalId: 'cushion', accountId: 'save', amount: tenge(200_000), date: '2026-10-01', decisionId: null }],
  };
}

/** Профиль со всем, что прогноз раньше выбрасывал (D119): проценты, крупные траты на семью, рассрочки весь год, подарки деньгами. */
function live(o: ProfileOpts = {}): AppState {
  return profile({ interest: true, lumps: true, habit: true, gifts: true, ...o });
}

/**
 * Человек ответил на вопросы: пособие повышают, после стипендии «ничего не изменится», при нехватке брать из подушки, потом из базы;
 * проценты по копилке считать, крупные траты на семью повторятся, новых рассрочек не будет, подарки деньгами учитывать.
 */
function answered(s: AppState): AppState {
  return {
    ...s,
    settings: {
      ...s.settings,
      incomeEndsAnswered: ['stip'],
      drawOrder: ['cushion', 'base'],
      incomeSchedule: s.settings.incomeSchedule.map((x) => (x.id === 'ben' ? { ...x, indexed: true } : x)),
      accounts: s.settings.accounts.map((a) => (a.accountId === 'save' ? { ...a, rateBp: 900 } : a)),
      lumps: { E_family: true },
      newInstallments: false,
      extraIncome: true,
    },
  };
}

describe('здравый смысл: профиль «как у живого человека»', () => {
  const found = sanityCheck(live(), TODAY).findings;
  const ids = new Set(found.map((f) => f.id));

  it('храповик: ошибки — ровно известные дефекты + неотвеченные вопросы (новая — регресс; исчезла — убери из списка)', () => {
    expect(sanityFails(live(), TODAY)).toEqual([...KNOWN_DEFECTS, ...UNANSWERED].sort());
  });

  it('храповик после ответов: остаются только известные дефекты модели', () => {
    expect(sanityFails(answered(live()), TODAY)).toEqual([...KNOWN_DEFECTS].sort());
  });

  it('подушка, которой «нет» при деньгах на счетах, — видна как предупреждение: порядок целей решает человек', () => {
    expect(found.find((x) => x.id === 'cushion_ignores_money')?.level).toBe('warn');
  });

  it('конец стипендии: вопрос «что изменится?» с первым месяцем без неё и id дохода', () => {
    const f = found.find((x) => x.id === 'income_drop_flat_spend');
    expect(f?.level).toBe('fail');
    expect(f?.months?.[0]).toBe('2027-07');
    expect(f?.ref).toBe('stip');
  });

  it('«ничего не изменится» — уже ответ: предупреждение, а не ошибка', () => {
    const s = profile();
    const r = sanityCheck({ ...s, settings: { ...s.settings, incomeEndsAnswered: ['stip'] } }, TODAY).findings;
    expect(r.find((x) => x.id === 'income_drop_flat_spend')?.level).toBe('warn');
  });

  it('«урежу траты» или «другой доход» в плане — вопроса больше нет', () => {
    const s = profile();
    const cut = { id: 'ev1', title: 'Меньше трат', date: '2027-07-01', kind: 'recurring_change' as const, amount: tenge(-20_000) };
    const job = { id: 'ev2', title: 'Работа', date: '2027-07-05', kind: 'income_start' as const, amount: tenge(150_000), dayOfMonth: 5, incomeKind: 'work' as const };
    for (const ev of [cut, job]) {
      const r = sanityCheck({ ...s, settings: { ...s.settings, plannedEvents: [ev] } }, TODAY).findings;
      expect(r.some((x) => x.id === 'income_drop_flat_spend')).toBe(false);
    }
  });

  it('доход, который повышают, в прогнозе растёт раз в год на инфляцию; «нет» — не растёт', () => {
    const s = answered(live());
    const sim = sanityCheck(s, TODAY).ctx!.sim;
    // пособие 40 000 повышают (+10 %); повышений в истории не видно — в январе (D119), не «через год от сегодня»; стипендии уже нет; + подарки 10 000
    const incomeOf = (r: typeof sim, m: string) => r.months.find((x) => x.month === m)!.income;
    expect(incomeOf(sim, '2026-12')).toBe(tenge(40_000 + 50_000 + 10_000));
    expect(incomeOf(sim, '2027-01')).toBe(tenge(44_000 + 50_000 + 10_000));
    expect(incomeOf(sim, '2028-01')).toBe(tenge(48_400 + 10_000));
    const no = { ...s, settings: { ...s.settings, incomeSchedule: s.settings.incomeSchedule.map((x) => ({ ...x, indexed: false })) } };
    expect(incomeOf(sanityCheck(no, TODAY).ctx!.sim, '2028-01')).toBe(tenge(40_000 + 10_000));
    expect(sanityCheck(no, TODAY).findings.find((x) => x.id === 'one_sided_inflation')?.level).toBe('warn');
  });

  it('месяцы, когда траты больше дохода, — найдены и названы', () => {
    const f = found.find((x) => x.id === 'negative_months');
    expect(f).toBeDefined();
    expect(f!.months!.length).toBeGreaterThan(0);
  });

  it('траты по истории с другим доходом — замечены', () => {
    expect(ids.has('baseline_other_income')).toBe(true);
  });

  it('каждая находка — с текстом без кодов и NaN', () => {
    for (const f of found) {
      expect(f.text.length).toBeGreaterThan(20);
      expect(f.text).not.toMatch(/NaN|undefined|\b[IEU]_[A-Za-z_]+/);
    }
  });
});

describe('нехватка денег: сначала свободные, потом цели, которые выбрал человек (D109)', () => {
  const roots = (m: { goalProgress: Record<string, number> }) => (m.goalProgress.base ?? 0) + (m.goalProgress.cushion ?? 0);

  it('без выбора — цели не трогаются, вопрос «из каких целей брать?»', () => {
    const r = sanityCheck(profile(), TODAY);
    expect(r.findings.find((f) => f.id === 'labels_exceed_money')?.level).toBe('fail');
    expect(Object.keys(r.ctx!.sim.drawnFrom)).toEqual([]);
  });

  it('с выбором — за целями никогда не числится больше, чем денег; берётся по порядку, который выбрал человек', () => {
    const r = sanityCheck(answered(profile()), TODAY);
    for (const m of r.ctx!.sim.months) expect(roots(m)).toBeLessThanOrEqual(Math.max(0, m.assets));
    expect(r.findings.some((f) => f.id === 'labels_exceed_money')).toBe(false);
    // первая в списке — подушка: из неё и берётся, база не тронута, пока подушки хватает
    const d = r.ctx!.sim.drawnFrom;
    expect(Object.keys(d)).toContain('cushion');
    expect(r.findings.some((f) => f.id === 'goal_drawn' && f.ref === 'cushion')).toBe(true);
  });

  it('пока свободные деньги есть — цели не трогаются', () => {
    // нехватка меньше свободных денег: на карте 500 тыс. свободных
    const s = answered(profile());
    const rich = { ...s, imported: { ...s.imported!, operations: [...s.imported!.operations, { kind: 'income' as const, id: 'gift', date: '2026-10-30', amount: tenge(500_000), accountId: 'card', categoryId: null, tagIds: [], comment: '' }] } };
    expect(sanityCheck(rich, TODAY).ctx!.sim.drawnFrom).toEqual({});
  });
});

describe('здравый смысл: чистый профиль без ложных срабатываний', () => {
  it('стабильный доход, подушка с деньгами, без инфляции, без рассрочек и редких трат — ошибок нет', () => {
    const s = profile({ incomeEnds: false, pastJob: false, rare: false, boundSavings: false, installment: false, inflationBp: 0, interest: false, lumps: false, habit: false, gifts: false });
    const r = sanityCheck(s, TODAY);
    expect(r.findings.filter((f) => f.level === 'fail')).toEqual([]);
    expect(r.findings.map((f) => f.id)).not.toContain('negative_months');
  });

  it('по одному признаку — ровно одна своя ошибка', () => {
    const clean = { incomeEnds: false, pastJob: false, rare: false, boundSavings: false, installment: false, inflationBp: 0, interest: false, lumps: false, habit: false, gifts: false };
    expect(sanityFails(profile({ ...clean, incomeEnds: true }), TODAY)).toEqual(['income_drop_flat_spend']);
    expect(sanityFails(profile({ ...clean, inflationBp: 1000 }), TODAY)).toEqual(['one_sided_inflation']);
    // редкие траты — не ошибка: они показываются отдельно и на «Обзоре», и в прогнозе (D109)
    expect(sanityFails(profile({ ...clean, rare: true }), TODAY)).toEqual([]);
    expect(sanityFails(profile({ ...clean, interest: true }), TODAY)).toEqual(['interest_ignored']);
    expect(sanityFails(profile({ ...clean, lumps: true }), TODAY)).toEqual(['lumps_lost']);
    expect(sanityFails(profile({ ...clean, gifts: true }), TODAY)).toEqual(['income_omitted']);
    expect(sanityFails(profile({ ...clean, installment: true, habit: true }), TODAY)).toEqual(['installment_habit']);
  });
});

describe('данные, которые прогноз раньше выбрасывал (D119): учитываются только по ответу', () => {
  const inputOf = (s: AppState) => buildSimInput(s, TODAY).input;
  const sumInterest = (s: AppState) => sanityCheck(s, TODAY).ctx!.sim.months.reduce((a, m) => a + m.interestAccrued, 0);

  it('проценты: без ответа — 0 и вопрос с подсказанной ставкой по факту; «да» — копилка растёт; «нет» — 0 без вопроса', () => {
    const s = live();
    expect(sumInterest(s)).toBe(0);
    const f = sanityCheck(s, TODAY).findings.find((x) => x.id === 'interest_ignored');
    expect(f?.ref).toBe('save');
    expect(f?.text).toMatch(/годовых/);
    const yes = { ...s, settings: { ...s.settings, accounts: s.settings.accounts.map((a) => (a.accountId === 'save' ? { ...a, rateBp: 900 } : a)) } };
    expect(sumInterest(yes)).toBeGreaterThan(tenge(100_000));
    const no = { ...s, settings: { ...s.settings, accounts: s.settings.accounts.map((a) => (a.accountId === 'save' ? { ...a, rateBp: 0 } : a)) } };
    expect(sumInterest(no)).toBe(0);
    expect(sanityFails(no, TODAY)).not.toContain('interest_ignored');
  });

  it('крупные траты на семью: «да» — отдельная строка «сверх обычного месяца» = за год / 12 − медиана', () => {
    const s = live();
    expect(inputOf(s).expenses.some((e) => e.key === 'E_family#lumps')).toBe(false);
    const yes = { ...s, settings: { ...s.settings, lumps: { E_family: true } } };
    const line = inputOf(yes).expenses.find((e) => e.key === 'E_family#lumps');
    // окно ноябрь 2025 – октябрь 2026: 12 × 1 000 + 3 × 30 000 = 102 000 → 8 500 в месяц − обычный месяц 1 000
    expect(line?.monthly).toBe(tenge(7_500));
    expect(expensePart(yes, line!.key)).toBe('rare');
  });

  it('рассрочки как раньше: «да» — после текущих платежей средний платёж продолжается', () => {
    const s = live();
    const yes = { ...s, settings: { ...s.settings, newInstallments: true } };
    const habit = inputOf(yes).expenses.filter((e) => e.key.startsWith('installments#habit'));
    // текущая рассрочка 25 000 до августа 2027 = средней → новых до сентября 2027 нет
    expect(habit.map((e) => [e.start, e.monthly])).toEqual([['2027-09-01', tenge(25_000)]]);
    expect(inputOf({ ...s, settings: { ...s.settings, newInstallments: false } }).expenses.some((e) => e.key.startsWith('installments#habit'))).toBe(false);
  });

  it('подарки деньгами: «да» — отдельный доход по медиане за 12 мес.', () => {
    const s = live();
    const yes = { ...s, settings: { ...s.settings, extraIncome: true } };
    expect(inputOf(yes).incomes.find((x) => x.id === 'extra#income')?.amount).toBe(tenge(10_000));
    expect(inputOf(s).incomes.some((x) => x.id === 'extra#income')).toBe(false);
  });

  it('месяц повышения — по истории: пособие подняли в январе → в прогнозе следующее повышение тоже в январе', () => {
    const s = live();
    const ops = s.imported!.operations.map((o) => (o.kind === 'income' && o.categoryId === 'ben' && o.date >= '2026-01' ? { ...o, amount: tenge(44_000) } : o));
    const item = { ...s.settings.incomeSchedule.find((x) => x.id === 'ben')!, amount: tenge(44_000), indexed: true };
    const st = { ...s, imported: { ...s.imported!, operations: ops }, settings: { ...s.settings, incomeSchedule: s.settings.incomeSchedule.map((x) => (x.id === 'ben' ? item : x)) } };
    expect(raiseMonth(buildSimInput(st, TODAY).overview.classification!.ops, TODAY, item)).toBe(1);
    expect(inputOf(st).incomes.find((x) => x.id === 'ben')?.growthAnchor).toBe('2026-01-12');
  });
});

describe('редкие траты: «повторится?» (D110, аудит №4 С2)', () => {
  const ids = (s: AppState) => sparseExpenses(s, TODAY).map((x) => x.categoryId);

  it('находит категории с 1–2 тратами за год; 3 и больше, ежемесячные и рассрочки — нет', () => {
    const s = profile();
    // одежда — 2 траты; подарки — 3; еда и развлечения — каждый месяц; телефон — рассрочка
    expect(ids(s)).toEqual(['clothes']);
    const x = sparseExpenses(s, TODAY)[0]!;
    expect(x.count).toBe(2);
    expect(x.total).toBe(tenge(60_000));
    expect(x.monthly).toBeGreaterThan(0);
  });

  it('вопрос виден в проверке здравого смысла как предупреждение с категорией', () => {
    const f = sanityCheck(profile(), TODAY).findings.filter((x) => x.id === 'oneoff_averaged');
    expect(f.map((x) => x.ref)).toEqual(['clothes']);
    expect(f[0]!.level).toBe('warn');
    // новых ошибок это не добавляет
    expect(sanityFails(profile(), TODAY)).toEqual([...KNOWN_DEFECTS, ...UNANSWERED_BASE].sort());
  });

  it('«разовая»: трата уходит из прогноза, вопрос не повторяется, капитал растёт', () => {
    const s = profile();
    const after = applyRepeatAnswer(s, 'clothes', 'never');
    expect(ids(after)).toEqual([]);
    expect(sanityCheck(after, TODAY).findings.map((x) => x.id)).not.toContain('oneoff_averaged');
    const reg = classRegistry(after.settings.classes);
    expect(reg.find((c) => c.id === 'U_E_ne_povtoritsya')?.behavior).toBe('excluded');
    expect(capitalAt(baseForecast(after, TODAY, 12), 12)!).toBeGreaterThan(capitalAt(baseForecast(s, TODAY, 12), 12)!);
  });

  it('«повторяется»: прогноз не меняется, но вопрос снят', () => {
    const s = profile();
    const after = applyRepeatAnswer(s, 'clothes', 'repeat');
    expect(ids(after)).toEqual([]);
    expect(capitalAt(baseForecast(after, TODAY, 12), 12)).toBe(capitalAt(baseForecast(s, TODAY, 12), 12));
  });

  it('предпросмотр совпадает с тем, что получится после ответа, и состояние не меняет', () => {
    const s = profile();
    const before = JSON.stringify(s);
    const pv = previewRepeat(s, TODAY, 'clothes', 12);
    expect(JSON.stringify(s)).toBe(before);
    expect(pv.now).toBe(capitalAt(baseForecast(s, TODAY, 12), 12));
    expect(pv.ifNever).toBe(capitalAt(baseForecast(applyRepeatAnswer(s, 'clothes', 'never'), TODAY, 12), 12));
    expect(pv.ifNever!).toBeGreaterThan(pv.now!);
  });

  it('без редких трат вопросов нет', () => {
    expect(ids(profile({ rare: false }))).toEqual([]);
  });
});

describe('окно «можно тратить до…» (D111, аудит №4 С7)', () => {
  const withSmall = (amount: number): AppState => {
    const s = profile();
    return { ...s, settings: { ...s.settings, incomeSchedule: [...s.settings.incomeSchedule, { id: 'small', title: 'Мелкий перевод', dayOfMonth: 11, amount: tenge(amount), kind: 'stable' }] } };
  };

  it('мелкий доход (меньше четверти месячных трат) окно не режет: до пособия 12-го, а не до перевода 11-го', () => {
    const o = buildOverview(withSmall(4_000), TODAY);
    expect(o.nextIncome).toMatchObject({ date: '2026-11-12', title: 'Пособие' });
    expect(sanityCheck(withSmall(4_000), TODAY).findings.map((f) => f.id)).not.toContain('spend_window_small_income');
  });

  it('доход, который что-то значит для трат, окно ограничивает как раньше', () => {
    expect(buildOverview(withSmall(60_000), TODAY).nextIncome).toMatchObject({ date: '2026-11-11', title: 'Мелкий перевод' });
  });

  it('если все доходы мелкие — ближайший любой, окно не пропадает', () => {
    const s = withSmall(4_000);
    const tiny = { ...s, settings: { ...s.settings, incomeSchedule: [{ id: 'small', title: 'Мелкий перевод', dayOfMonth: 11, amount: tenge(4_000), kind: 'stable' as const }] } };
    expect(buildOverview(tiny, TODAY).nextIncome).toMatchObject({ date: '2026-11-11', source: 'schedule' });
  });
});

describe('история разной длины: 1, 3 и 12+ месяцев (аудит №4, §4)', () => {
  const allowed = [...KNOWN_DEFECTS, ...UNANSWERED];
  for (const [name, from] of [['1 месяц', '2026-10'], ['3 месяца', '2026-08'], ['14 месяцев', '2025-09']] as const) {
    it(`${name}: ничего не ломается, цифры конечные, новых ошибок нет`, () => {
      const s = profile({ from });
      const r = sanityCheck(s, TODAY);
      expect(r.ctx!.sim.months.length).toBeGreaterThan(12);
      for (const m of r.ctx!.sim.months) expect(Number.isFinite(m.capital)).toBe(true);
      expect(Number.isFinite(r.ctx!.overview.spend.usualMonthly)).toBe(true);
      // ошибки (fail) — только известные вопросы без ответа, ничего нового из-за короткой истории
      for (const id of sanityFails(s, TODAY)) expect(allowed).toContain(id);
      // и после ответов на вопросы — ни одной ошибки
      expect(sanityFails(answered(s), TODAY)).toEqual([...KNOWN_DEFECTS].sort());
    });
  }
});

describe('обычные траты по месяцам без зарплаты (D113, аудит №4 С2б)', () => {
  // профиль: работа только в июле–августе 2026; до этого — 10 месяцев без работы; сентябрь–октябрь — без работы
  const mode = (s: AppState, m: 'last' | 'no_work'): AppState => ({ ...s, settings: { ...s.settings, baselineMode: m } });
  const usual = (s: AppState) => buildOverview(s, TODAY).spend.usualMonthly;

  it('по умолчанию окно — последние месяцы, режим «без зарплаты» — только месяцы без работы, давние тоже', () => {
    const s = profile({ rare: false });
    const o = buildOverview(mode(s, 'no_work'), TODAY);
    const months = o.baseline.months;
    expect(months).not.toContain('2026-07');
    expect(months).not.toContain('2026-08');
    expect(months.length).toBe(6);
    expect(months[0]! < '2026-07').toBe(true);
    expect(buildOverview(s, TODAY).baseline.months).toContain('2026-07');
  });

  it('предпросмотр совпадает с расчётом после ответа и не меняет состояние', () => {
    const s = profile();
    const before = JSON.stringify(s);
    const pv = previewBaselineMode(s, TODAY, 12)!;
    expect(JSON.stringify(s)).toBe(before);
    expect(pv.usualNow).toBe(usual(s));
    expect(pv.usualNoWork).toBe(usual(mode(s, 'no_work')));
    expect(pv.capitalNoWork).toBe(capitalAt(baseForecast(mode(s, 'no_work'), TODAY, 12), 12));
  });

  it('месяцев без работы меньше трёх — режим не включается, всё как по умолчанию', () => {
    const s = profile({ from: '2026-07' });
    expect(previewBaselineMode(s, TODAY)).toBeNull();
    expect(usual(mode(s, 'no_work'))).toBe(usual(s));
  });

  it('после ответа предупреждение о тратах за месяцы с другим доходом не повторяется', () => {
    const s = profile();
    const ask = (x: AppState) => sanityCheck(x, TODAY).findings.map((f) => f.id);
    expect(ask(mode(s, 'no_work'))).not.toContain('baseline_other_income');
    expect(ask(mode(s, 'last'))).not.toContain('baseline_other_income');
  });

  it('Обзор и прогноз считают обычные траты одним числом в обоих режимах', () => {
    for (const m of ['last', 'no_work'] as const) expect(sanityFails(answered(mode(profile(), m)), TODAY)).toEqual([...KNOWN_DEFECTS].sort());
  });
});

describe('предпросмотр «что будет, если…» (D114)', () => {
  it('«урежу траты»: капитал растёт, состояние не меняется, нулевая сумма = как сейчас', () => {
    const s = profile();
    const before = JSON.stringify(s);
    const none = previewEvent(s, TODAY, []);
    expect(none.capital(12).with).toBe(none.capital(12).without);
    const cut = previewEvent(s, TODAY, [cutEvent('p', '2026-12-01', tenge(10_000))]);
    expect(cut.capital(12).with!).toBeGreaterThan(cut.capital(12).without!);
    expect(JSON.stringify(s)).toBe(before);
  });

  it('предпросмотр совпадает с тем, что получится после добавления события в план', () => {
    const s = profile();
    const ev = cutEvent('p', '2026-12-01', tenge(15_000));
    const pv = previewEvent(s, TODAY, [ev]);
    const planned = { ...s, settings: { ...s.settings, plannedEvents: [...s.settings.plannedEvents, ev] } };
    expect(pv.capital(12).with).toBe(capitalAt(baseForecast(planned, TODAY, 12), 12));
  });

  it('предпросмотр ответа про повышение дохода: «да» не хуже «нет» и совпадает с расчётом после ответа', () => {
    const s = profile();
    const pv = previewIndexed(s, TODAY, 'ben', 36);
    expect(pv.yes!).toBeGreaterThan(pv.no!);
    const yes = { ...s, settings: { ...s.settings, incomeSchedule: s.settings.incomeSchedule.map((x) => (x.id === 'ben' ? { ...x, indexed: true } : x)) } };
    expect(pv.yes).toBe(capitalAt(baseForecast(yes, TODAY, 36), 36));
  });

  it('долг дольше года: строка «ещё должен» только тогда', () => {
    expect(debtAfterYear(profile(), TODAY)).toBe(0);
    const s = profile();
    const long = { ...s, obligations: [makeInstallment({ id: 'ph2', title: 'Долгая', owner: 'self', remaining: tenge(900_000), remainingAsOf: TODAY, payment: tenge(25_000), firstDate: '2026-11-17' })] };
    expect(debtAfterYear(long, TODAY)).toBeGreaterThan(0);
  });
});

describe('«Твой этап» (D115)', () => {
  const noSavings = (st: AppState): AppState => ({ ...st, settings: { ...st.settings, accounts: st.settings.accounts.map((x) => (x.accountId === 'save' ? { ...x, excluded: true, reviewed: true } : x)) } });
  const extraCost = (st: AppState, amount: number): AppState => ({ ...st, settings: { ...st.settings, plannedEvents: [...st.settings.plannedEvents, { id: 'x', kind: 'recurring_change', date: '2026-11-05', title: 'Траты', amount: tenge(amount) }] } });
  it('этап — только на сколько месяцев хватит денег без дохода: деньги сразу ÷ (траты + платежи) по границам 1 / 3 / 6 / 12', () => {
    // 905 000 ÷ 55 000 = 16,4 мес. (округление вниз до десятых — «16,5» не обещаем)
    expect(personStage(profile(), TODAY)!).toMatchObject({ stage: 5, coverMonths: 16.4, liquid: tenge(905_000), needMonthly: tenge(55_000) });
    // меньше накоплено при тех же тратах — ниже этап: 60 000 ÷ 55 000 = 1,0 → 2; 245 000 ÷ 55 000 = 4,4 → 3; 415 000 ÷ 55 000 = 7,5 → 4
    expect(personStage(noSavings(profile()), TODAY)!).toMatchObject({ stage: 1, coverMonths: 0.3 });
    expect(personStage(profile({ from: '2026-09' }), TODAY)!).toMatchObject({ stage: 2, coverMonths: 1 });
    expect(personStage(profile({ from: '2026-08' }), TODAY)!).toMatchObject({ stage: 3, coverMonths: 4.4 });
    expect(personStage(profile({ from: '2026-07' }), TODAY)!).toMatchObject({ stage: 4, coverMonths: 7.5 });
  });

  it('сколько остаётся в месяц на этап не влияет — только на то, когда дойдёшь до следующего', () => {
    const base = personStage(profile({ from: '2026-08' }), TODAY)!;
    const worse = personStage(extraCost(profile({ from: '2026-08' }), 60_000), TODAY)!;
    expect(worse.surplusMonthly).toBeLessThan(base.surplusMonthly);
    expect(worse.stage).toBe(base.stage);
    expect(worse.coverMonths).toBe(base.coverMonths);
    expect(worse.next!.by).not.toBe(base.next!.by);
  });

  it('денег почти нет: первый этап, следующий — сколько не хватает до месяца без дохода и когда при нынешнем темпе', () => {
    const r = personStage(noSavings(profile()), TODAY)!;
    expect(r.stage).toBe(1);
    // 20 000 ÷ 55 000 = 0,3 месяца
    expect(r.coverMonths).toBe(0.3);
    // месяц — по помесячному прогнозу (D122): остаток ноября уже приходит, поэтому декабрь, а не «35 000 / 20 000 в месяц → январь»
    expect(r.next).toMatchObject({ toStage: 2, missing: tenge(35_000), by: '2026-12' });
  });

  it('считается по деньгам сейчас: те же доходы и траты, но другие накопления — другой этап', () => {
    expect(personStage(profile(), TODAY)!.stage).not.toBe(personStage(noSavings(profile()), TODAY)!.stage);
  });

  it('без данных этапа нет; состояние не меняется', () => {
    expect(personStage(emptyState(), TODAY)).toBeNull();
    const s = profile();
    const before = JSON.stringify(s);
    personStage(s, TODAY);
    expect(JSON.stringify(s)).toBe(before);
  });
});

describe('«Где можно сэкономить» (D116)', () => {
  const r = () => savingOptions(profile(), TODAY)!;

  it('категории по размеру: еда, развлечения, подарки, одежда; рассрочки и доходы не входят', () => {
    const o = r();
    expect(o.options.map((x) => x.title)).toEqual(['Продукты', 'Развлечения', 'Подарки', 'Одежда']);
    expect(o.options[0]!.share).toBeGreaterThan(o.options[1]!.share);
    expect(o.options.map((x) => x.title)).not.toContain('Телефон');
    // сумма категорий в месяц = то, что в среднем ушло за 6 полных месяцев
    expect(o.months).toBe(6);
  });

  it('цена урезания: 20 % категории в месяц, капитал через год растёт ровно на 12 таких месяцев (без инфляции и сдвигов — не меньше)', () => {
    const food = r().options.find((x) => x.categoryId === 'food')!;
    expect(food.cut!.perMonth).toBe(Math.round(food.monthly * 0.2));
    expect(food.cut!.capitalGain12).toBeGreaterThan(0);
    // даты целей — только те, что сдвинулись
    for (const sh of food.cut!.shifts) expect(sh.from).not.toBe(sh.to);
  });

  it('динамика за полгода: стабильная категория — 0 %, пропавшая — минус сто, мало истории — нет числа', () => {
    expect(r().options.find((x) => x.categoryId === 'food')!.trendPct).toBe(0);
    expect(r().options.find((x) => x.categoryId === 'gifts')!.trendPct).toBe(-100);
    const short = savingOptions(profile({ from: '2026-09' }), TODAY)!;
    for (const x of short.options) expect(x.trendPct).toBeNull();
  });

  it('предпросмотр урезания совпадает с событием в плане; состояние не меняется; без данных — нет отчёта', () => {
    const s = profile();
    const before = JSON.stringify(s);
    const food = savingOptions(s, TODAY)!.options[0]!;
    expect(JSON.stringify(s)).toBe(before);
    const ev = cutEvent('x', '2026-12-01', food.cut!.perMonth);
    const planned = { ...s, settings: { ...s.settings, plannedEvents: [...s.settings.plannedEvents, ev] } };
    expect(food.cut!.capitalGain12).toBe(capitalAt(baseForecast(planned, TODAY, 12), 12)! - capitalAt(baseForecast(s, TODAY, 12), 12)!);
    expect(savingOptions(emptyState(), TODAY)).toBeNull();
  });
});

describe('«Из А в Б» (D117)', () => {
  const withCut = (st: AppState, perMonth: number): AppState => ({ ...st, settings: { ...st.settings, plannedEvents: [...st.settings.plannedEvents, cutEvent('r', '2026-12-01', perMonth)] } });
  const reaches = (st: AppState, id: string, by: string): boolean => {
    const d = baseForecast(st, TODAY, 36).goalDates[id] ?? null;
    return d !== null && d <= by;
  };

  it('успеваешь — ничего менять не нужно', () => {
    const r = planToGoal(profile(), TODAY, 'base', '2027-12')!;
    expect(r).toMatchObject({ onTrack: true, missing: 0, lateMonths: null });
    expect(r.levers.perMonth).toBe(0);
  });

  it('не успеваешь на месяц: сколько в месяц нужно, и это минимальная сумма — с ней успеваешь, на шаг меньше — нет', () => {
    const s = profile();
    const r = planToGoal(s, TODAY, 'base', '2027-03')!;
    expect(r).toMatchObject({ onTrack: false, lateMonths: 1, reachMonth: '2027-04' });
    expect(r.missing).toBeGreaterThan(0);
    const need = r.levers.perMonth!;
    expect(need).toBeGreaterThan(0);
    expect(reaches(withCut(s, need), 'base', '2027-03')).toBe(true);
    expect(reaches(withCut(s, need - 50_000), 'base', '2027-03')).toBe(false);
  });

  it('не успеть никак (месяц, а нужна вся подушка): рычаг «в месяц» — null; «поставить выше» считает, что получат остальные', () => {
    const s = profile();
    const r = planToGoal(s, TODAY, 'cushion', '2026-12')!;
    expect(r.levers.perMonth).toBeNull();
    expect(r.levers.reorder).not.toBeNull();
    expect(r.levers.reorder!.shifts.map((x) => x.goalId)).toContain('base');
  });

  it('свободные деньги в копилках закрывают недостающее не больше, чем есть', () => {
    const s = profile({ boundSavings: false });
    const r = planToGoal(s, TODAY, 'base', '2026-12')!;
    expect(r.levers.freeSavings.available).toBeGreaterThan(0);
    expect(r.levers.freeSavings.covers).toBe(Math.min(r.levers.freeSavings.available, r.missing));
  });

  it('не цель, папка, прошлый месяц и пустое состояние — нет расчёта; состояние не меняется', () => {
    const s = profile();
    const before = JSON.stringify(s);
    expect(planToGoal(s, TODAY, 'нет-такой', '2027-03')).toBeNull();
    expect(planToGoal(s, TODAY, 'base', '2026-10')).toBeNull();
    expect(planToGoal(emptyState(), TODAY, 'base', '2027-03')).toBeNull();
    planToGoal(s, TODAY, 'cushion', '2027-06');
    expect(JSON.stringify(s)).toBe(before);
  });
});

describe('«Подушка: 0 из …» (D122)', () => {
  const o = (st: AppState) => buildOverview(st, TODAY);
  const cushion = (st: AppState) => flattenTree(o(st).goalTree).find((n) => n.goal.id === 'cushion')!;
  const has = (st: AppState) => sanityCheck(st, TODAY).findings.some((f) => f.id === 'cushion_ignores_money');
  const apply = (st: AppState): AppState => {
    const f = cushionFill(st, TODAY, 'cf')!;
    return { ...st, fundings: [...st.fundings, ...f.fundings] };
  };
  /** На каждом счёте закреплено за целями не больше, чем на нём лежит: «назначено больше, чем есть» не возникает. */
  const overAssigned = (st: AppState): boolean => {
    const ov = o(st);
    return ov.capital.accounts.some((a) => ov.fundings.filter((f) => f.accountId === a.accountId).reduce((x, f) => x + f.amount, 0) > a.balance);
  };
  /** Копилка не привязана к цели: метки явные, часть денег свободна. */
  const explicit = (): AppState => {
    const s = profile({ boundSavings: false });
    return { ...s, fundings: [{ id: 'f-base', goalId: 'base', accountId: 'save', amount: tenge(600_000), date: '2026-10-01', decisionId: null }] };
  };

  it('плашка есть, когда деньги на счетах закреплены за другой целью, а подушка пуста', () => {
    expect(has(profile())).toBe(true);
    expect(cushion(profile()).progress).toBe(0);
  });

  it('порядок целей плашку не убирает: подушка первой — метки денег прежние (это и была жалоба «выхожу обратно, а плашка висит»)', () => {
    const s = profile();
    const first = { ...s, goals: reorderGoals(s.goals, ['cushion', 'base']) };
    expect(has(first)).toBe(true);
  });

  it('копилка привязана к цели: перенос добирает подушку до её суммы, цель теряет столько же, лишнего не назначено', () => {
    const s = profile();
    const f = cushionFill(s, TODAY, 'cf')!;
    expect(f.moved).toBe(f.need);
    expect(f.fromFree).toBe(0);
    expect(f.fromGoals.map((x) => x.goalId)).toEqual(['base']);
    expect(f.fromGoals[0]!.amount).toBe(f.moved);
    // привязка: у «Базы» снимается сама, отдельной записью минус — только у явных меток
    expect(f.fundings.every((x) => x.amount > 0)).toBe(true);
    const after = apply(s);
    expect(cushion(after).progress).toBe(cushion(after).goal.targetMin);
    const baseBefore = flattenTree(o(s).goalTree).find((n) => n.goal.id === 'base')!.progress;
    const baseAfter = flattenTree(o(after).goalTree).find((n) => n.goal.id === 'base')!.progress;
    expect(baseBefore - baseAfter).toBe(f.moved);
    expect(overAssigned(after)).toBe(false);
    expect(has(after)).toBe(false);
  });

  it('явные метки: сначала свободное в копилке, потом метки других целей; сумма на счёте не растёт, плашка уходит', () => {
    const s = explicit();
    expect(has(s)).toBe(true);
    const f = cushionFill(s, TODAY, 'cf')!;
    expect(f.moved).toBe(f.need);
    const after = apply(s);
    expect(overAssigned(after)).toBe(false);
    expect(has(after)).toBe(false);
    // всего за целями столько же, сколько было плюс свободное, которое взяли
    const total = (st: AppState) => o(st).fundings.reduce((x, y) => x + y.amount, 0);
    expect(total(after) - total(s)).toBe(f.fromFree);
    expect(cushion(after).progress).toBe(f.need + cushion(s).progress);
  });

  it('денег не хватает на всю подушку — переносится сколько есть, остаток назван', () => {
    const s = explicit();
    const big = { ...s, goals: s.goals.map((g) => (g.id === 'cushion' ? { ...g, targetRule: { kind: 'months_of_base' as const, months: 60, basis: 'essential' as const } } : g)) };
    const f = cushionFill(big, TODAY, 'cf')!;
    expect(f.moved).toBeLessThan(f.need);
    // перенесено всё, что есть на счёте: за подушкой — вся копилка, у других целей и свободных денег не осталось ничего
    const after = apply(big);
    expect(overAssigned(after)).toBe(false);
    expect(cushion(after).progress).toBe(f.moved);
  });

  it('«так задумано» убирает плашку; без ответа она на месте', () => {
    const s = profile();
    expect(has(s)).toBe(true);
    expect(has({ ...s, settings: { ...s.settings, sanityAnswered: ['cushion_ignores_money'] } })).toBe(false);
  });

  it('переносить нечего: подушка набрана, нет подушки, нет данных — null; состояние не меняется', () => {
    const s = profile();
    const before = JSON.stringify(s);
    expect(cushionFill(emptyState(), TODAY, 'cf')).toBeNull();
    expect(cushionFill({ ...s, goals: s.goals.filter((g) => g.id !== 'cushion') }, TODAY, 'cf')).toBeNull();
    expect(cushionFill(apply(s), TODAY, 'cf')).toBeNull();
    cushionFill(s, TODAY, 'cf');
    expect(JSON.stringify(s)).toBe(before);
  });
});

describe('«Из А в Б» (D123)', () => {
  const noSavings = (st: AppState): AppState => ({ ...st, settings: { ...st.settings, accounts: st.settings.accounts.map((x) => (x.accountId === 'save' ? { ...x, excluded: true, reviewed: true } : x)) } });
  const extraCost = (st: AppState, amount: number): AppState => ({ ...st, settings: { ...st.settings, plannedEvents: [...st.settings.plannedEvents, { id: 'x', kind: 'recurring_change', date: '2026-11-05', title: 'Траты', amount: tenge(amount) }] } });

  it('человек сам выбирает этап Б: нужно = месяцы этапа × «уходит в месяц»; не хватает = нужно − есть', () => {
    const s = noSavings(profile());
    const r = routeTo(s, TODAY, 3)!;
    expect(r.from.stage).toBe(1);
    expect(r.to.no).toBe(3);
    // 3 мес. × 55 000 (30 000 траты + 25 000 платежи) = 165 000; есть 20 000
    expect(r.target).toBe(tenge(165_000));
    expect(r.missing).toBe(tenge(145_000));
    // месяц тот же, что на экране «Твой этап» для соседнего этапа, и по пути названы все этапы между А и Б
    expect(routeTo(s, TODAY, 2)!.by).toBe(personStage(s, TODAY)!.next!.by);
    expect(r.steps.map((x) => [x.stage.no, x.by])).toEqual([[2, '2026-12'], [3, '2027-05']]);
    expect(r.by).toBe('2027-05');
  });

  it('сколько откладывать сверху за срок: (нужно − будет к сроку) ÷ месяцев, округлено вверх до 1 000; если и так успеваешь — 0', () => {
    const r = routeTo(noSavings(profile()), TODAY, 5)!;
    // 12 × 55 000 = 660 000; при нынешнем темпе не набирается, за 3 месяца — самая большая добавка
    expect(r.target).toBe(tenge(660_000));
    expect(r.by).toBeNull();
    expect(r.deadlines.map((d) => [d.months, d.month])).toEqual([[3, '2027-02'], [6, '2027-05'], [12, '2027-11'], [24, '2028-11']]);
    const extra = r.deadlines.map((d) => d.extraMonthly);
    expect(extra).toEqual([tenge(185_000), tenge(83_000), tenge(47_000), tenge(29_000)]);
    expect(extra.every((x, i) => i === 0 || x < extra[i - 1]!)).toBe(true);
    // добавка в самом деле приводит к цели: событие «тратить меньше» на эту сумму даёт нужный запас к сроку
    const cut = { ...noSavings(profile()), settings: { ...noSavings(profile()).settings, plannedEvents: [cutEvent('c', '2026-12-01', tenge(47_000))] } };
    expect(liquidReachMonth(baseForecast(cut, TODAY, 60), tenge(660_000))! <= '2027-11').toBe(true);
    // до месяца без дохода и так успеваем — добавка 0
    expect(routeTo(noSavings(profile()), TODAY, 2)!.deadlines.slice(0, 3).map((d) => d.extraMonthly)).toEqual([0, 0, 0]);
  });

  it('траты больше доходов: сказано, на сколько, и цель не набирается', () => {
    const r = routeTo(extraCost(noSavings(profile()), 60_000), TODAY, 3)!;
    expect(r.deficitMonthly).toBe(tenge(40_000));
    expect(r.by).toBeNull();
  });

  it('платежи по долгам кончатся — сказано, когда и сколько освободится', () => {
    expect(routeTo(noSavings(profile()), TODAY, 3)!.debtFree).toEqual({ from: '2027-09', freed: tenge(25_000) });
  });

  it('на верхнем этапе выбирать некуда; этап не ниже текущего — нельзя; пустые данные — null; состояние не меняется', () => {
    expect(higherStages(5)).toEqual([]);
    expect(higherStages(1).map((d) => d.no)).toEqual([2, 3, 4, 5]);
    expect(routeTo(profile(), TODAY, 5)).toBeNull();
    expect(routeTo(noSavings(profile()), TODAY, 1)).toBeNull();
    expect(routeTo(emptyState(), TODAY, 3)).toBeNull();
    const s = profile();
    const before = JSON.stringify(s);
    routeTo(noSavings(s), TODAY, 4);
    expect(JSON.stringify(s)).toBe(before);
  });
});
