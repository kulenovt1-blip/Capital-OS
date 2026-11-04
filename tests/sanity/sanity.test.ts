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
import { applyRepeatAnswer, baseForecast, capitalAt, previewRepeat, sparseExpenses } from '../../engine/simple';
import { classRegistry } from '../../engine/classes';
import { buildOverview } from '../../engine/overview';
import type { OpClass } from '../../engine/classify';
import { acc, cat, dataset, exp, inc, trf } from '../support/build';

const TODAY = '2026-11-04';

/**
 * Известные ошибки модели (аудит №4, claude/audit-4-model-sanity.md). Исправил — убери строку. Цель — пусто.
 * Закрыты: К1 подушка (D108 — не ошибка, решение человека, warn), К2 и К3 (D108 — вопросы), К4 и С1 (D109).
 */
const KNOWN_DEFECTS: SanityId[] = [];
/** Вопросы, на которые человек ещё не ответил: пока нет ответа — вывод держится на допущении (D108, D109). */
const UNANSWERED: SanityId[] = ['income_drop_flat_spend', 'labels_exceed_money', 'one_sided_inflation'];

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
}

/** Обезличенный профиль: студент с пособием и стипендией, два месяца летней работы, карта ~20 тыс., копилка ~650 тыс. */
function profile(o: ProfileOpts = {}): AppState {
  const { incomeEnds = true, pastJob = true, rare = true, boundSavings = true, installment = true } = o;
  const cats = [cat('food', 'Продукты'), cat('fun', 'Развлечения'), cat('gifts', 'Подарки'), cat('clothes', 'Одежда'), cat('job', 'Зарплата', 'income'), cat('stip', 'Стипендия', 'income'), cat('ben', 'Пособие', 'income'), cat('phone', 'Телефон')];
  const first = o.from ?? '2025-09';
  const ops = [inc(`${first}-01`, 'card', 20_000, null)];
  const rareOps: Record<string, number> = rare ? { '2025-12': 40_000, '2026-03': 40_000, '2026-04': 30_000, '2026-07': 40_000, '2026-09': 30_000 } : {};
  let card = 20_000;
  for (const m of months(first, '2026-10')) {
    const job = pastJob && m >= '2026-07' && m <= '2026-08';
    const income = (job ? 150_000 : 0) + 40_000 + 50_000;
    if (job) ops.push(inc(`${m}-05`, 'card', 150_000, 'job'));
    ops.push(inc(`${m}-12`, 'card', 40_000, 'ben'), inc(`${m}-23`, 'card', 50_000, 'stip'));
    ops.push(exp(`${m}-03`, 'card', 10_000, 'food'), exp(`${m}-17`, 'card', 10_000, 'food'), exp(`${m}-20`, 'card', 10_000, 'fun'));
    let spent = 30_000;
    if (installment && m >= '2026-08') (ops.push(exp(`${m}-17`, 'card', 25_000, 'phone')), (spent += 25_000));
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

/** Человек ответил на вопросы: пособие повышают, после стипендии «ничего не изменится», при нехватке брать из подушки, потом из базы. */
function answered(s: AppState): AppState {
  return { ...s, settings: { ...s.settings, incomeEndsAnswered: ['stip'], drawOrder: ['cushion', 'base'], incomeSchedule: s.settings.incomeSchedule.map((x) => (x.id === 'ben' ? { ...x, indexed: true } : x)) } };
}

describe('здравый смысл: профиль «как у живого человека»', () => {
  const found = sanityCheck(profile(), TODAY).findings;
  const ids = new Set(found.map((f) => f.id));

  it('храповик: ошибки — ровно известные дефекты + неотвеченные вопросы (новая — регресс; исчезла — убери из списка)', () => {
    expect(sanityFails(profile(), TODAY)).toEqual([...KNOWN_DEFECTS, ...UNANSWERED].sort());
  });

  it('храповик после ответов: остаются только известные дефекты модели', () => {
    expect(sanityFails(answered(profile()), TODAY)).toEqual([...KNOWN_DEFECTS].sort());
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
    const s = answered(profile());
    const sim = sanityCheck(s, TODAY).ctx!.sim;
    // пособие 40 000 повышают (+10 %) через 12 месяцев от сегодня — в тот же месяц, когда дорожают траты; стипендии уже нет
    expect(sim.months.find((m) => m.month === '2027-10')!.income).toBe(tenge(40_000));
    expect(sim.months.find((m) => m.month === '2027-11')!.income).toBe(tenge(44_000));
    const no = { ...s, settings: { ...s.settings, incomeSchedule: s.settings.incomeSchedule.map((x) => ({ ...x, indexed: false })) } };
    expect(sanityCheck(no, TODAY).ctx!.sim.months.find((m) => m.month === '2027-11')!.income).toBe(tenge(40_000));
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
    const s = profile({ incomeEnds: false, pastJob: false, rare: false, boundSavings: false, installment: false, inflationBp: 0 });
    const r = sanityCheck(s, TODAY);
    expect(r.findings.filter((f) => f.level === 'fail')).toEqual([]);
    expect(r.findings.map((f) => f.id)).not.toContain('negative_months');
  });

  it('по одному признаку — ровно одна своя ошибка', () => {
    const clean = { incomeEnds: false, pastJob: false, rare: false, boundSavings: false, installment: false, inflationBp: 0 };
    expect(sanityFails(profile({ ...clean, incomeEnds: true }), TODAY)).toEqual(['income_drop_flat_spend']);
    expect(sanityFails(profile({ ...clean, inflationBp: 1000 }), TODAY)).toEqual(['one_sided_inflation']);
    // редкие траты — не ошибка: они показываются отдельно и на «Обзоре», и в прогнозе (D109)
    expect(sanityFails(profile({ ...clean, rare: true }), TODAY)).toEqual([]);
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
    expect(sanityFails(profile(), TODAY)).toEqual([...KNOWN_DEFECTS, ...UNANSWERED].sort());
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
