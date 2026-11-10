/**
 * Синтетические профили проб «Положения» v4 (project docs: position-probe-scripts, -v2-a, -v3-a, -v4-a).
 * Перенесены из проб без изменений логики; изменены только пути импорта и типы. Все данные выдуманы.
 * Используются как фикстуры: ожидаемые значения снимаются НЕ с движка, а с исходных скриптов проб
 * (см. tests/fixtures/position/README.md).
 */
import { emptyState, type AppState } from '../../engine/state';
import { setCategoryClass, type OpClass } from '../../engine/classify';
import { mergeAccountSettings, type ManualAccount } from '../../engine/settings';
import { makeInstallment } from '../../engine/obligations';
import { tenge } from '../../engine/money';
import type { Operation } from '../../engine/types';
import { acc, cat, dataset, exp, inc, trf } from './build';

/** Дата проб. Все профили строятся относительно неё. */
export const TODAY = '2026-11-04';

export function monthsRange(from: string, to: string): string[] {
  const out: string[] = [];
  let [y, m] = from.split('-').map(Number) as [number, number];
  for (;;) {
    const k = `${y}-${String(m).padStart(2, '0')}`;
    if (k > to) return out;
    out.push(k);
    m === 12 ? ((y += 1), (m = 1)) : (m += 1);
  }
}

interface Income {
  id: string;
  title: string;
  cls: 'I_work' | 'I_stipend' | 'I_benefit' | 'I_other' | 'I_interest' | 'F_borrowed';
  day: number;
  amount: number | ((m: string) => number);
  kind: 'work' | 'stable' | 'irregular';
  sched: number;
  end?: string;
}
interface Expense { id: string; title: string; cls: 'E_base' | 'E_fun' | 'E_other' | 'E_installment_own' | 'F_borrowed_back'; amount: number | ((m: string) => number); day: number; from?: string }
interface Debt { id: string; title?: string; remaining: number; payment: number; firstDate: string }
export interface Spec {
  name: string;
  from: string;
  opening: number;
  incomes: Income[];
  expenses: Expense[];
  debts: Debt[];
}

export function build(spec: Spec): AppState {
  const cats = [
    ...spec.incomes.map((i) => cat(`c_${i.id}`, i.title, 'income')),
    ...spec.expenses.map((e) => cat(`c_${e.id}`, e.title, 'expense')),
  ];
  const ops: Operation[] = [];
  const first = spec.from;
  if (spec.opening > 0) ops.push(inc(`${first}-01`, 'save', spec.opening, null));
  ops.push(inc(`${first}-01`, 'card', 20_000, null));
  let card = 20_000;
  for (const m of monthsRange(first, '2026-10')) {
    for (const i of spec.incomes) {
      const a = typeof i.amount === 'function' ? i.amount(m) : i.amount;
      if (a > 0) (ops.push(inc(`${m}-${String(i.day).padStart(2, '0')}`, 'card', a, `c_${i.id}`)), (card += a));
    }
    for (const e of spec.expenses) {
      if (e.from && m < e.from) continue;
      const a = typeof e.amount === 'function' ? e.amount(m) : e.amount;
      if (a > 0) (ops.push(exp(`${m}-${String(e.day).padStart(2, '0')}`, 'card', a, `c_${e.id}`)), (card -= a));
    }
    // в конце месяца карта возвращается к ~20 тыс.: лишнее — в копилку, нехватка — из копилки
    const d = card - 20_000;
    if (d > 0) ops.push(trf(`${m}-26`, 'card', 'save', d));
    else if (d < 0) ops.push(trf(`${m}-26`, 'save', 'card', -d));
    card = 20_000;
  }
  const data = dataset({ accounts: [acc('card', 'Карта'), acc('save', 'Заначка')], categories: cats, operations: ops });
  const s = emptyState();
  let cls = s.settings.classification;
  for (const i of spec.incomes) cls = setCategoryClass(cls, data.categories.find((c) => c.id === `c_${i.id}`)!, i.cls as OpClass, 'income');
  for (const e of spec.expenses) cls = setCategoryClass(cls, data.categories.find((c) => c.id === `c_${e.id}`)!, e.cls as OpClass, 'expense');
  const accounts = mergeAccountSettings([], data.accounts).map((a) => (a.accountId === 'save' ? { ...a, kind: 'savings' as const } : { ...a, kind: 'spend' as const }));
  return {
    ...s,
    imported: data,
    importedAt: TODAY,
    settings: {
      ...s.settings,
      simpleMigrated: true,
      classification: cls,
      accounts,
      incomeSchedule: spec.incomes.map((i) => ({ id: i.id, title: i.title, dayOfMonth: i.day, amount: tenge(i.sched), kind: i.kind, ...(i.end ? { end: i.end } : {}) })),
    },
    obligations: spec.debts.map((d) => makeInstallment({ id: d.id, title: d.title ?? d.id, owner: 'self', remaining: tenge(d.remaining), remainingAsOf: TODAY, payment: tenge(d.payment), firstDate: d.firstDate })),
  };
}

const freelance = (m: string) => ({ '2025-09': 0, '2025-10': 900_000, '2025-11': 0, '2025-12': 0, '2026-01': 1_200_000, '2026-02': 0, '2026-03': 400_000, '2026-04': 0, '2026-05': 0, '2026-06': 1_000_000, '2026-07': 0, '2026-08': 600_000, '2026-09': 0, '2026-10': 700_000 } as Record<string, number>)[m] ?? 0;

export const SPECS: Spec[] = [
  {
    name: 'A Студент',
    from: '2025-09',
    opening: 0,
    incomes: [
      { id: 'stip', title: 'Стипендия', cls: 'I_stipend', day: 23, amount: 50_000, kind: 'stable', sched: 50_000, end: '2027-06-25' },
      { id: 'ben', title: 'Пособие', cls: 'I_benefit', day: 12, amount: 40_000, kind: 'stable', sched: 40_000 },
    ],
    expenses: [
      { id: 'food', title: 'Еда', cls: 'E_base', amount: 30_000, day: 3 },
      { id: 'fun', title: 'Развлечения', cls: 'E_fun', amount: 10_000, day: 20 },
      { id: 'phone', title: 'Телефон', cls: 'E_installment_own', amount: 25_000, day: 17, from: '2025-11' },
    ],
    debts: [{ id: 'ph', title: 'Телефон', remaining: 150_000, payment: 25_000, firstDate: '2026-11-17' }],
  },
  {
    name: 'B Работающий',
    from: '2025-09',
    opening: 0,
    incomes: [{ id: 'job', title: 'Зарплата', cls: 'I_work', day: 5, amount: 400_000, kind: 'work', sched: 400_000 }],
    expenses: [
      { id: 'food', title: 'Еда', cls: 'E_base', amount: 100_000, day: 3 },
      { id: 'rent', title: 'Аренда', cls: 'E_other', amount: 120_000, day: 1 },
      { id: 'fun', title: 'Развлечения', cls: 'E_fun', amount: 40_000, day: 20 },
    ],
    debts: [],
  },
  {
    name: 'C С долгами',
    from: '2025-09',
    opening: 60_000,
    incomes: [{ id: 'job', title: 'Зарплата', cls: 'I_work', day: 5, amount: 250_000, kind: 'work', sched: 250_000 }],
    expenses: [
      { id: 'food', title: 'Еда', cls: 'E_base', amount: 80_000, day: 3 },
      { id: 'rent', title: 'Аренда', cls: 'E_other', amount: 70_000, day: 1 },
      { id: 'fun', title: 'Развлечения', cls: 'E_fun', amount: 15_000, day: 20 },
      { id: 'car', title: 'Кредит на машину', cls: 'E_installment_own', amount: 60_000, day: 10 },
      { id: 'tv', title: 'Рассрочка', cls: 'E_installment_own', amount: 20_000, day: 12 },
    ],
    debts: [
      { id: 'car', title: 'Кредит на машину', remaining: 2_400_000, payment: 60_000, firstDate: '2026-11-10' },
      { id: 'tv', title: 'Рассрочка', remaining: 120_000, payment: 20_000, firstDate: '2026-11-12' },
    ],
  },
  {
    name: 'D Высокий доход',
    from: '2025-09',
    opening: 0,
    incomes: [{ id: 'job', title: 'Зарплата', cls: 'I_work', day: 5, amount: 1_500_000, kind: 'work', sched: 1_500_000 }],
    expenses: [
      { id: 'food', title: 'Еда', cls: 'E_base', amount: 300_000, day: 3 },
      { id: 'rent', title: 'Аренда', cls: 'E_other', amount: 250_000, day: 1 },
      { id: 'fun', title: 'Развлечения', cls: 'E_fun', amount: 150_000, day: 20 },
    ],
    debts: [],
  },
  {
    name: 'E Капитал, нестабильный поток',
    from: '2025-09',
    opening: 15_000_000,
    incomes: [{ id: 'free', title: 'Фриланс', cls: 'I_other', day: 15, amount: freelance, kind: 'irregular', sched: 400_000 }],
    expenses: [
      { id: 'food', title: 'Еда', cls: 'E_base', amount: 150_000, day: 3 },
      { id: 'rent', title: 'Аренда', cls: 'E_other', amount: 150_000, day: 1 },
      { id: 'fun', title: 'Развлечения', cls: 'E_fun', amount: 100_000, day: 20 },
    ],
    debts: [],
  },
];

// ───────────── profiles2: аренда — обязательный расход ─────────────
export const SPECS2: Spec[] = SPECS.map((s) => ({ ...s, expenses: s.expenses.map((e) => (e.id === 'rent' ? { ...e, cls: 'E_base' as const } : e)) }));

function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const round = (x: number, step = 5000) => Math.max(step, Math.round(x / step) * step);

/** Случайный синтетический профиль. Детерминирован по seed. */
export function randomSpec(seed: number): Spec {
  const r = rng(seed);
  const income = Math.exp(Math.log(90_000) + r() * Math.log(1_800_000 / 90_000));
  const nSrc = r() < 0.6 ? 1 : r() < 0.7 ? 2 : 3;
  const fromIdx = Math.floor(r() * 6);
  const from = ['2025-09', '2025-10', '2025-11', '2025-12', '2026-01', '2026-02'][fromIdx]!;
  const shares = Array.from({ length: nSrc }, () => 0.3 + r());
  const sum = shares.reduce((a, b) => a + b, 0);
  const incomes: Spec['incomes'] = shares.map((sh, i) => {
    const amt = round((income * sh) / sum);
    const roll = r();
    const kind: 'work' | 'stable' | 'irregular' = roll < 0.45 ? 'work' : roll < 0.7 ? 'stable' : 'irregular';
    const endsSoon = kind !== 'irregular' && r() < 0.3;
    const end = endsSoon ? `${r() < 0.5 ? '2027-03' : '2027-09'}-25` : undefined;
    const cls = kind === 'work' ? 'I_work' : kind === 'stable' ? (r() < 0.5 ? 'I_stipend' : 'I_benefit') : 'I_other';
    const amount: number | ((m: string) => number) = kind === 'irregular' ? (m: string) => ((m.charCodeAt(5) * 7 + m.charCodeAt(6) * 3 + i) % 5 < 2 ? 0 : round(amt * 2.2)) : amt;
    return { id: `s${i}`, title: `Источник ${i + 1}`, cls, day: 5 + i * 7, amount, kind, sched: amt, ...(end ? { end } : {}) } as Income;
  });
  const spendRatio = 0.45 + r() * 0.7;
  const spend = income * spendRatio;
  const essShare = 0.35 + r() * 0.4;
  const expenses: Spec['expenses'] = [
    { id: 'food', title: 'Еда', cls: 'E_base', amount: round(spend * essShare * 0.5), day: 3 },
    { id: 'rent', title: 'Жильё', cls: 'E_base', amount: round(spend * essShare * 0.5), day: 1 },
    { id: 'fun', title: 'Развлечения', cls: 'E_fun', amount: round(spend * (1 - essShare)), day: 20 },
  ];
  const debts: Spec['debts'] = [];
  if (r() < 0.4) {
    const pay = round(income * (0.03 + r() * 0.42));
    const left = pay * Math.round(6 + r() * 90);
    expenses.push({ id: 'loan', title: 'Платёж по кредиту', cls: 'E_installment_own', amount: pay, day: 10 });
    debts.push({ id: 'loan', title: 'Кредит', remaining: left, payment: pay, firstDate: '2026-11-10' });
  }
  const outflow = expenses.reduce((a, e) => a + (typeof e.amount === 'number' ? e.amount : 0), 0);
  const cushionMonths = r() < 0.25 ? r() * 1.2 : Math.exp(Math.log(0.5) + r() * Math.log(60 / 0.5));
  const deficit = Math.max(0, outflow - income);
  const opening = Math.round(Math.max(cushionMonths * outflow, deficit * 14 + 30_000));
  return { name: `R${seed}`, from, opening, incomes, expenses, debts };
}

// ───────────── gen3: динамические и стресс-профили ─────────────
/** Опции проб: ручные активы и ручные доходы добавляются к состоянию (в движке они уже часть `AppState`). */
export interface ProbeOpts {
  manual?: ManualAccount[];
  manualIncome?: { id: string; title: string; amount: number; passive: true }[];
}

export function applyProbeOpts(state0: AppState, opts: ProbeOpts = {}): AppState {
  return {
    ...state0,
    manualAccounts: [...state0.manualAccounts, ...(opts.manual ?? [])],
    settings: { ...state0.settings, incomeSchedule: [...state0.settings.incomeSchedule, ...(opts.manualIncome ?? []).map((x) => ({ id: x.id, title: x.title, dayOfMonth: 1, amount: tenge(x.amount), kind: 'stable' as const, passive: true as const }))] },
  };
}

/** Динамический профиль: доход ступенью (×0,5…1,6) в случайный месяц, расходы с дрейфом (−20…+40 % за историю). */
export function randomSpecDyn(seed: number): Spec {
  const sp = randomSpec(seed);
  const r = rng(seed * 7919 + 13);
  const months = monthsRange(sp.from, '2026-10');
  const n = months.length;
  const step = r() < 0.6 ? months[3 + Math.floor(r() * (n - 5))]! : null;
  const k = 0.5 + r() * 1.1;
  const drift = -0.2 + r() * 0.6;
  const incomes = sp.incomes.map((i) => {
    if (typeof i.amount !== 'number') return i;
    const base = i.amount;
    return { ...i, amount: (m: string) => round(step && m >= step ? base * k : base), sched: round(step ? base * k : base) };
  });
  const expenses = sp.expenses.map((e) => {
    if (typeof e.amount !== 'number' || e.cls === 'E_installment_own') return e;
    const base = e.amount;
    return { ...e, amount: (m: string) => round(base * (1 + (drift * months.indexOf(m)) / Math.max(1, n - 1))) };
  });
  return { ...sp, name: `D${seed}`, incomes, expenses };
}

export interface Case { name: string; state: AppState; opts: ProbeOpts; family: string }
const prop = (amount: number) => ({ id: 'prop', title: 'Недвижимость (вручную)', balance: tenge(Math.round(amount)), balanceDate: TODAY, liquidity: { kind: 'locked_until' as const, date: '2031-01-01' }, comment: 'введено вручную' });
const inv = (amount: number) => ({ id: 'inv', title: 'Инвестиции (вручную)', balance: tenge(Math.round(amount)), balanceDate: TODAY, liquidity: { kind: 'days' as const, days: 3 }, comment: 'введено вручную' });
const plus = (st: AppState, ev: unknown[]) => ({ ...st, settings: { ...st.settings, plannedEvents: [...st.settings.plannedEvents, ...ev] } }) as AppState;

/** Стресс-выборка: семейства крайних сценариев. */
export function stressCase(seed: number): Case {
  const r = rng(seed * 104729 + 7);
  const fam = ['illiquid', 'oneoff', 'heavy', 'cliff', 'allirr', 'fire', 'strong', 'newjob'][seed % 8]!;
  let sp = randomSpec(seed + 1000);
  let opts: ProbeOpts = {};
  let st: AppState | null = null;
  const totalInc = sp.incomes.reduce((a, i) => a + (typeof i.sched === 'number' ? i.sched : 0), 0);
  const spendE = sp.expenses.reduce((a, e) => a + (typeof e.amount === 'number' ? e.amount : 0), 0);
  if (fam === 'illiquid') {
    sp = { ...sp, opening: Math.round(spendE * r() * 0.8) };
    opts = { manual: [prop(spendE * (30 + r() * 270))] as never };
  } else if (fam === 'oneoff') {
    st = plus(build(sp), [{ id: 'x1', title: 'Большая трата', date: '2027-0' + (2 + Math.floor(r() * 7)) + '-10', kind: 'one_off', amount: tenge(Math.round(totalInc * (0.3 + r() * 24))) }]);
  } else if (fam === 'heavy') {
    const pay = round(totalInc * (0.38 + r() * 0.3));
    sp = { ...sp, expenses: [...sp.expenses.filter((e) => e.id !== 'loan'), { id: 'loan', title: 'Платёж по кредиту', cls: 'E_installment_own', amount: pay, day: 10 }], debts: [{ id: 'loan', title: 'Кредит', remaining: pay * Math.round(40 + r() * 140), payment: pay, firstDate: '2026-11-10' }] };
  } else if (fam === 'cliff') {
    const end = ['2026-12-20', '2027-01-20', '2027-03-20', '2027-04-20'][Math.floor(r() * 4)]!;
    sp = { ...sp, incomes: sp.incomes.map((i) => ({ ...i, kind: i.kind === 'irregular' ? ('work' as const) : i.kind, end })) };
  } else if (fam === 'allirr') {
    sp = { ...sp, incomes: sp.incomes.map((i, idx) => ({ ...i, kind: 'irregular' as const, cls: 'I_other' as const, amount: (m: string) => ((m.charCodeAt(5) * 7 + m.charCodeAt(6) * 3 + idx) % 4 < 1 ? 0 : round((i.sched as number) * 1.6)) })) };
  } else if (fam === 'fire') {
    const need = spendE;
    sp = { ...sp, opening: Math.round(need * (3 + r() * 6)) };
    opts = { manual: [inv(need * (150 + r() * 350))] as never, manualIncome: r() < 0.5 ? [{ id: 'div', title: 'Дивиденды', amount: Math.round(need * (0.3 + r() * 0.9)), passive: true as const }] : [] };
  } else if (fam === 'strong') {
    sp = { ...sp, opening: Math.round(spendE * (8 + r() * 20)), expenses: sp.expenses.map((e) => (e.id === 'fun' ? { ...e, amount: round((e.amount as number) * 0.4) } : e)), debts: [] };
    sp = { ...sp, expenses: sp.expenses.filter((e) => e.cls !== 'E_installment_own') };
  } else if (fam === 'newjob') {
    sp = { ...sp, incomes: sp.incomes.map((i) => ({ ...i, amount: typeof i.amount === 'number' ? Math.round(i.amount * 0.3) : i.amount, sched: Math.round((i.sched as number) * 0.3) })) };
    st = plus(build(sp), [{ id: 'j1', title: 'Новая работа', date: '2027-0' + (1 + Math.floor(r() * 5)) + '-01', kind: 'income_start', amount: tenge(Math.round(totalInc * (0.8 + r() * 0.8))), incomeKind: 'work' }]);
  }
  return { name: `S${seed}-${fam}`, state: st ?? build(sp), opts, family: fam };
}

// ───────────── gen4: долговая спираль и контрольные ─────────────
export type SpiralFam = 'spiralA' | 'spiralB' | 'spiralAB' | 'heavyOK' | 'mortgage' | 'oneBorrow' | 'friendBridge';
export const SPIRAL_FAMS: SpiralFam[] = ['spiralA', 'spiralB', 'spiralAB', 'heavyOK', 'mortgage', 'oneBorrow', 'friendBridge'];

export function spiralCase(seed: number, fam: SpiralFam): { name: string; state: AppState; fam: SpiralFam } {
  const r = rng(seed * 7919 + SPIRAL_FAMS.indexOf(fam) * 101 + 3);
  const I = round(300_000 + r() * 700_000);
  const months = monthsRange('2025-11', '2026-10');
  const startBorrow = months[4 + Math.floor(r() * 3)]!;
  const spiral = fam.startsWith('spiral');
  const payShare = fam === 'mortgage' ? 0.28 + r() * 0.08 : fam === 'heavyOK' ? 0.38 + r() * 0.1 : 0.4 + r() * 0.1;
  const living = spiral ? 0.58 + r() * 0.1 : fam === 'heavyOK' ? 0.4 + r() * 0.08 : 0.4 + r() * 0.2;
  const pay = round(I * payShare);
  const spec: Spec = {
    name: `${fam}${seed}`, from: '2025-11', opening: Math.round(I * (spiral ? 0.5 + r() * 1.5 : 1 + r() * 4)),
    incomes: [{ id: 'job', title: 'Зарплата', cls: 'I_work', day: 5, amount: I, kind: 'work', sched: I }],
    expenses: [
      { id: 'food', title: 'Еда', cls: 'E_base', amount: round(I * living * 0.45), day: 3 },
      { id: 'rent', title: 'Жильё', cls: 'E_base', amount: round(I * living * 0.35), day: 1 },
      { id: 'fun', title: 'Развлечения', cls: 'E_fun', amount: round(I * living * 0.2), day: 20 },
      { id: 'loan', title: 'Платёж по кредиту', cls: 'E_installment_own', amount: fam === 'spiralB' || fam === 'spiralAB' ? (m: string) => (m <= '2026-05' ? pay : 0) : pay, day: 10 },
    ],
    debts: [{ id: 'loan', title: 'Кредит', remaining: pay * Math.round(fam === 'mortgage' ? 180 : 30 + r() * 40), payment: pay, firstDate: '2026-11-10' }],
  };
  const deficit = Math.max(0, I * (living + payShare) - I);
  const borrow = (amountFn: (m: string) => number) => spec.incomes.push({ id: 'borrow', title: 'Займ', cls: 'F_borrowed', day: 12, amount: amountFn, kind: 'irregular', sched: 0 });
  const back = (amountFn: (m: string) => number) => spec.expenses.push({ id: 'back', title: 'Возврат долга', cls: 'F_borrowed_back', amount: amountFn, day: 15 });
  if (fam === 'spiralA' || fam === 'spiralAB') {
    const x = round(Math.max(deficit, I * 0.1) * (0.9 + r() * 0.5));
    borrow((m) => (m >= startBorrow && r() < 0.9 ? x : 0));
    back((m) => (m >= startBorrow && r() < 0.3 ? round(x * 0.2) : 0));
  } else if (fam === 'oneBorrow') {
    const when = months[3 + Math.floor(r() * 4)]!; const x = round(I * (2 + r() * 2));
    borrow((m) => (m === when ? x : 0));
    back((m) => (m > when && m <= months[months.indexOf(when) + 6]! ? round(x / 6) : 0));
  } else if (fam === 'friendBridge') {
    const w1 = months[3]!, w2 = months[8]!; const x = round(I * (0.3 + r() * 0.4));
    borrow((m) => (m === w1 || m === w2 ? x : 0));
    back((m) => (m === months[months.indexOf(w1) + 1] || m === months[months.indexOf(w2) + 1] ? x : 0));
  }
  const st = build(spec);
  const state: AppState = { ...st, settings: { ...st.settings, incomeSchedule: st.settings.incomeSchedule.filter((i) => i.id !== 'borrow') } } as AppState;
  if (fam === 'spiralB' || fam === 'spiralAB') {
    // кредит заведён на конец мая; платежи за июнь–октябрь не найдены в операциях → просрочка
    const ob = makeInstallment({ id: 'loan', title: 'Кредит', owner: 'self', remaining: tenge(pay * 40), remainingAsOf: '2026-05-31', payment: tenge(pay), firstDate: '2026-06-10', match: { categoryIds: ['c_loan'] } });
    return { name: spec.name, state: { ...state, obligations: [ob] } as AppState, fam };
  }
  return { name: spec.name, state, fam };
}

// ───────────── pool4: именные профили ─────────────
export const mk = (name: string, opening: number, incomeAmt: number, ex: [string, 'E_base' | 'E_fun' | 'E_installment_own', number][], debt?: { remaining: number; payment: number }): Spec => ({
  name, from: '2025-09', opening,
  incomes: [{ id: 'job', title: 'Зарплата', cls: 'I_work', day: 5, amount: incomeAmt, kind: 'work', sched: incomeAmt }],
  expenses: ex.map(([id, cls, a], i) => ({ id, title: id, cls, amount: a, day: 1 + i * 4 })),
  debts: debt ? [{ id: 'mort', title: 'Ипотека', remaining: debt.remaining, payment: debt.payment, firstDate: '2026-11-10' }] : [],
});
export const H1 = (opening: number) => mk('H1', opening, 1_500_000, [['food', 'E_base', 200_000], ['rent', 'E_base', 150_000], ['fun', 'E_fun', 100_000], ['mort', 'E_installment_own', 750_000]], { remaining: 60_000_000, payment: 750_000 });

export interface NamedProfile { name: string; state: AppState; opts: ProbeOpts }

/** Именные профили проб: A–E, D34, H1, H1+, H2, M1b, «B + трата 3 млн». */
export function namedProfiles(): NamedProfile[] {
  const [A, B, C, D, E] = SPECS2.map(build);
  const propAcc = { id: 'prop', title: 'Недвижимость', balance: tenge(80_000_000), balanceDate: TODAY, liquidity: { kind: 'locked_until' as const, date: '2030-01-01' }, comment: 'введено вручную' };
  return [
    { name: 'A Студент', state: A!, opts: {} }, { name: 'B Работающий', state: B!, opts: {} }, { name: 'C С долгами', state: C!, opts: {} },
    { name: 'D Высокий доход', state: D!, opts: {} }, { name: 'E Капитал, нестабильный', state: E!, opts: {} },
    { name: 'D34', state: build(randomSpecDyn(34)), opts: {} },
    { name: 'H1 (запаса нет)', state: build(H1(0)), opts: {} }, { name: 'H1+ (запас 8 мес.)', state: build(H1(8_000_000)), opts: {} },
    { name: 'H2 платежи 36 %', state: build(mk('H2', 0, 700_000, [['food', 'E_base', 140_000], ['rent', 'E_base', 105_000], ['fun', 'E_fun', 30_000], ['mort', 'E_installment_own', 250_000]], { remaining: 30_000_000, payment: 250_000 })), opts: {} },
    { name: 'M1b богат, но неликвиден', state: build(mk('M1b', 0, 600_000, [['food', 'E_base', 150_000], ['rent', 'E_base', 150_000], ['fun', 'E_fun', 290_000]])), opts: { manual: [propAcc] } },
    { name: 'B + трата 3 млн', state: plus(B!, [{ id: 'x1', title: 'Большая трата', date: '2027-03-10', kind: 'one_off', amount: tenge(3_000_000) }]), opts: {} },
  ];
}

export interface ProbeProfile { name: string; family: string; state: AppState; opts: ProbeOpts }

/**
 * Полный набор профилей, на котором снят эталон ряда (tests/fixtures/position/series-reference.json):
 * 11 именных, 7 семейств долговой спирали × 3, R1–R30, D1–D30, стресс 0–31, три коротких истории профиля A.
 * Состав должен совпадать с /tmp/pos/ref-series.ts (проверяется тестом по именам).
 */
export function probeProfiles(): ProbeProfile[] {
  const out: ProbeProfile[] = [];
  for (const n of namedProfiles()) out.push({ name: n.name, family: 'именной', state: n.state, opts: n.opts });
  for (const fam of SPIRAL_FAMS) for (const seed of [1, 2, 3]) { const c = spiralCase(seed, fam); out.push({ name: c.name, family: 'спираль:' + fam, state: c.state, opts: {} }); }
  for (let i = 1; i <= 30; i++) { out.push({ name: `R${i}`, family: 'случайная', state: build(randomSpec(i)), opts: {} }); out.push({ name: `D${i}`, family: 'динамическая', state: build(randomSpecDyn(i)), opts: {} }); }
  for (let i = 0; i < 32; i++) { const c = stressCase(i); out.push({ name: c.name, family: 'стресс:' + c.family, state: c.state, opts: c.opts }); }
  for (const from of ['2026-09', '2026-06', '2026-03']) out.push({ name: `A (история с ${from})`, family: 'короткая история', state: build({ ...SPECS2[0]!, from }), opts: {} });
  return out;
}
