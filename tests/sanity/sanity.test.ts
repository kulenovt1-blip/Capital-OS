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
import type { OpClass } from '../../engine/classify';
import { acc, cat, dataset, exp, inc, trf } from '../support/build';

const TODAY = '2026-11-04';

/**
 * Известные ошибки модели (аудит №4, claude/audit-4-model-sanity.md). Исправил — убери строку.
 * К1 cushion_ignores_money · К4 labels_exceed_money · С1 expense_mismatch · К2 income_drop_flat_spend · К3 one_sided_inflation
 */
const KNOWN_DEFECTS: SanityId[] = ['cushion_ignores_money', 'expense_mismatch', 'income_drop_flat_spend', 'labels_exceed_money', 'one_sided_inflation'];

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
}

/** Обезличенный профиль: студент с пособием и стипендией, два месяца летней работы, карта ~20 тыс., копилка ~650 тыс. */
function profile(o: ProfileOpts = {}): AppState {
  const { incomeEnds = true, pastJob = true, rare = true, boundSavings = true, installment = true } = o;
  const cats = [cat('food', 'Продукты'), cat('fun', 'Развлечения'), cat('gifts', 'Подарки'), cat('clothes', 'Одежда'), cat('job', 'Зарплата', 'income'), cat('stip', 'Стипендия', 'income'), cat('ben', 'Пособие', 'income'), cat('phone', 'Телефон')];
  const ops = [inc('2025-09-01', 'card', 20_000, null)];
  const rareOps: Record<string, number> = rare ? { '2025-12': 40_000, '2026-03': 40_000, '2026-04': 30_000, '2026-07': 40_000, '2026-09': 30_000 } : {};
  let card = 20_000;
  for (const m of months('2025-09', '2026-10')) {
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

describe('здравый смысл: профиль «как у живого человека»', () => {
  const found = sanityCheck(profile(), TODAY).findings;
  const ids = new Set(found.map((f) => f.id));

  it('храповик: ошибки модели — ровно известные (новая — регресс; исчезла — убери из KNOWN_DEFECTS)', () => {
    expect(sanityFails(profile(), TODAY)).toEqual([...KNOWN_DEFECTS].sort());
  });

  it('подушка, которой «нет» при деньгах на счетах, — замечена (К1)', () => {
    expect(ids.has('cushion_ignores_money')).toBe(true);
  });

  it('падение дохода при прежних тратах — замечено (К2)', () => {
    const f = found.find((x) => x.id === 'income_drop_flat_spend');
    expect(f?.months?.[0]).toBe('2027-07');
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
    expect(sanityFails(profile({ ...clean, rare: true }), TODAY)).toEqual(['expense_mismatch']);
  });
});
