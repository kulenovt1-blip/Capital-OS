/**
 * Классы с поведением (DECISIONS D50–D56): мастер вопросов, реестр встроенных и своих классов,
 * разметка своими классами, резерв по всем «базовым», прогноз расходов по поведению.
 * Ожидания записаны до реализации.
 */
import { describe, it, expect } from 'vitest';
import {
  classFromAnswers, classRegistry, createCustomClass, validateClassDef, canDeleteClass, DEFAULT_CLASS_SETTINGS,
  type ClassDef, type ClassSettings,
} from '../../engine/classes';
import { classifyAll, setCategoryClass, validateClassification, DEFAULT_CLASSIFICATION, type OpClass } from '../../engine/classify';
import { baselineMonthly, monthlyFlows } from '../../engine/ledger';
import { buildSimInput } from '../../engine/plan';
import { buildOverview } from '../../engine/overview';
import { simulate } from '../../engine/simulate';
import { emptyState, parseState, serializeState, type AppState } from '../../engine/state';
import { tenge, tiyn } from '../../engine/money';
import { acc, cat, dataset, exp, inc } from '../support/build';

const TODAY = '2026-10-28';

describe('мастер: ответы → поведение класса', () => {
  it('деньги вернутся / ты вернёшь → не класс, а долг', () => {
    const r = classFromAnswers({ group: 'expense', returnsOrRepaid: true });
    expect(r.kind).toBe('redirect');
    if (r.kind === 'redirect') expect(r.to).toBe('debt');
  });
  it('перекладываешь между своими счетами → перевод', () => {
    const r = classFromAnswers({ group: 'expense', returnsOrRepaid: false, ownTransfer: true });
    expect(r.kind === 'redirect' && r.to).toBe('transfer');
  });
  it('платёж по рассрочке или кредиту → обязательство (иначе двойной счёт)', () => {
    const r = classFromAnswers({ group: 'expense', returnsOrRepaid: false, ownTransfer: false, installment: true });
    expect(r.kind === 'redirect' && r.to).toBe('obligation');
  });
  const exp0 = { group: 'expense' as const, returnsOrRepaid: false, ownTransfer: false, installment: false };
  it('без этого не прожить → базовый; входит в резерв', () => {
    const r = classFromAnswers({ ...exp0, essential: true, frequency: 'monthly', ends: null });
    expect(r.kind === 'class' && r.behavior).toBe('base');
    if (r.kind === 'class') expect(r.effects.join('\n')).toMatch(/резерв.*да/i);
  });
  it('базовый с датой окончания — базовый до даты', () => {
    const r = classFromAnswers({ ...exp0, essential: true, frequency: 'monthly', ends: '2027-08-31' });
    expect(r).toMatchObject({ kind: 'class', behavior: 'base', endDate: '2027-08-31' });
  });
  it('каждый месяц → регулярный; каждый месяц до даты → временный', () => {
    expect(classFromAnswers({ ...exp0, essential: false, frequency: 'monthly', ends: null })).toMatchObject({ kind: 'class', behavior: 'regular' });
    expect(classFromAnswers({ ...exp0, essential: false, frequency: 'monthly', ends: '2027-05-31' })).toMatchObject({ kind: 'class', behavior: 'temporary', endDate: '2027-05-31' });
  });
  it('несколько раз в год → нерегулярный с оценкой на год; разово → вне прогноза', () => {
    const r = classFromAnswers({ ...exp0, essential: false, frequency: 'irregular', ends: null, annualEstimate: tenge(120_000) });
    expect(r).toMatchObject({ kind: 'class', behavior: 'irregular', annualEstimate: tenge(120_000) });
    if (r.kind === 'class') expect(r.effects.join('\n')).toMatch(/год/);
    expect(classFromAnswers({ ...exp0, essential: false, frequency: 'once', ends: null })).toMatchObject({ kind: 'class', behavior: 'excluded' });
  });
  it('доход: может пропасть → «работа»; иначе «прочий»; дата окончания сохраняется', () => {
    expect(classFromAnswers({ group: 'income', canStop: true, incomeEnds: null })).toMatchObject({ kind: 'class', behavior: 'work' });
    expect(classFromAnswers({ group: 'income', canStop: false, incomeEnds: '2027-06-30' })).toMatchObject({ kind: 'class', behavior: 'other', endDate: '2027-06-30' });
  });
});

describe('реестр классов', () => {
  it('встроенные получают поведение по умолчанию; рассрочки — только через обязательства', () => {
    const reg = classRegistry(DEFAULT_CLASS_SETTINGS);
    const b = (id: string) => reg.find((c) => c.id === id)!.behavior;
    expect(b('E_base')).toBe('base');
    expect(['E_fun', 'E_family', 'E_health', 'E_edu', 'E_other'].map(b)).toEqual(['regular', 'regular', 'regular', 'regular', 'regular']);
    expect(b('E_installment_own')).toBe('installment');
    expect(b('I_work')).toBe('work');
    expect(b('I_stipend')).toBe('other');
    expect(reg.some((c) => c.id.startsWith('F_') || c.id.startsWith('T_'))).toBe(false);
  });

  it('поведение встроенного можно изменить, название и поведение рассрочки — нет', () => {
    const s: ClassSettings = { custom: [], overrides: { E_edu: { behavior: 'irregular', annualEstimate: tenge(60_000) } } };
    expect(classRegistry(s).find((c) => c.id === 'E_edu')).toMatchObject({ behavior: 'irregular', annualEstimate: tenge(60_000), builtin: true });
    const bad = classRegistry({ custom: [], overrides: { E_installment_own: { behavior: 'regular' } } });
    expect(bad.find((c) => c.id === 'E_installment_own')!.behavior).toBe('installment');
  });

  it('свой класс: id по группе, уникальный; временный требует дату', () => {
    const r = createCustomClass({ label: 'Подарки', group: 'expense', behavior: 'irregular', annualEstimate: tenge(120_000) }, DEFAULT_CLASS_SETTINGS);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.id).toMatch(/^U_E_/);
    const s: ClassSettings = { ...DEFAULT_CLASS_SETTINGS, custom: [r.value] };
    expect(createCustomClass({ label: 'Подарки', group: 'expense', behavior: 'regular' }, s).ok).toBe(false); // имя занято
    expect(validateClassDef({ id: 'U_E_x', label: 'Курсы', group: 'expense', behavior: 'temporary', builtin: false })).toContain('Для временного класса нужна дата окончания');
    expect(validateClassDef({ id: 'U_E_x', label: ' ', group: 'expense', behavior: 'regular', builtin: false }).join()).toMatch(/название/i);
    expect(createCustomClass({ label: 'Бонусы', group: 'income', behavior: 'other' }, s).ok && true).toBe(true);
  });

  it('класс, на который размечены категории, удалить нельзя', () => {
    const gifts: ClassDef = { id: 'U_E_gifts', label: 'Подарки', group: 'expense', behavior: 'irregular', builtin: false };
    const rules = setCategoryClass(DEFAULT_CLASSIFICATION, cat('c-g', 'Подарки'), 'U_E_gifts' as OpClass, 'expense');
    expect(canDeleteClass(gifts.id, rules).ok).toBe(false);
    expect(canDeleteClass(gifts.id, DEFAULT_CLASSIFICATION).ok).toBe(true);
    expect(canDeleteClass('E_fun', DEFAULT_CLASSIFICATION).ok).toBe(false); // встроенный
  });
});

describe('разметка своими классами', () => {
  const data = dataset({
    accounts: [acc('a')],
    categories: [cat('c-g', 'Подарки'), cat('c-bonus2', 'Премия', 'income')],
    operations: [exp('2026-09-10', 'a', 5_000, 'c-g'), inc('2026-09-11', 'a', 7_000, 'c-bonus2')],
  });
  it('свой расходный класс считается расходом; поставить его доходу нельзя', () => {
    let cls = setCategoryClass(DEFAULT_CLASSIFICATION, data.categories[0]!, 'U_E_gifts' as OpClass, 'expense');
    cls = setCategoryClass(cls, data.categories[1]!, 'U_E_gifts' as OpClass, 'income');
    const r = classifyAll(data, cls);
    expect(r.ops.map((o) => o.cls)).toEqual(['U_E_gifts', 'UNCLASSIFIED']);
    expect(r.byClass['U_E_gifts' as OpClass]).toEqual({ count: 1, total: tenge(5_000) });
    const f = monthlyFlows(r.ops, ['2026-09'])['2026-09']!;
    expect(f.expense).toBe(tenge(5_000));
    expect(f.byClass['U_E_gifts' as OpClass]).toBe(tenge(5_000));
  });
  it('JSON-правила принимают известные свои классы и отклоняют неизвестные', () => {
    const rules = { familyTags: [], rules: [{ categoryTitle: 'Подарки', class: 'U_E_gifts' }] };
    expect(validateClassification(rules, ['U_E_gifts']).ok).toBe(true);
    expect(validateClassification(rules, []).ok).toBe(false);
  });
});

/** 15 месяцев данных: продукты (база), такси (свой базовый), подарки (нерегулярно), курсы (до декабря), разовая покупка. */
function longState(extra: Partial<ClassSettings> = {}): AppState {
  const cats = [cat('c-food', 'Продукты'), cat('c-taxi', 'Такси'), cat('c-gifts', 'Подарки'), cat('c-courses', 'Курсы английского'), cat('c-tv', 'Телевизор'), cat('c-sal', 'Зарплата', 'income')];
  const ops = [];
  for (const m of ['2025-08', '2025-09', '2025-10', '2025-11', '2025-12', '2026-01', '2026-02', '2026-03', '2026-04', '2026-05', '2026-06', '2026-07', '2026-08', '2026-09', '2026-10']) {
    ops.push(exp(`${m}-03`, 'a', 60_000, 'c-food'), exp(`${m}-04`, 'a', 10_000, 'c-taxi'), inc(`${m}-05`, 'a', 200_000, 'c-sal'));
    if (m >= '2026-05') ops.push(exp(`${m}-06`, 'a', 25_000, 'c-courses'));
  }
  // подарки: 100 000 за последние 12 полных месяцев (окт 2025 – сен 2026), в апреле–сентябре только 2 месяца
  ops.push(exp('2025-12-20', 'a', 50_000, 'c-gifts'), exp('2026-03-08', 'a', 20_000, 'c-gifts'), exp('2026-05-10', 'a', 10_000, 'c-gifts'), exp('2026-09-15', 'a', 20_000, 'c-gifts'));
  ops.push(exp('2026-08-01', 'a', 300_000, 'c-tv'));
  const data = dataset({ accounts: [acc('a')], categories: cats, operations: ops });
  const s = emptyState();
  const custom: ClassDef[] = [
    { id: 'U_E_taxi', label: 'Такси', group: 'expense', behavior: 'base', builtin: false },
    { id: 'U_E_gifts', label: 'Подарки', group: 'expense', behavior: 'irregular', annualEstimate: tenge(240_000), builtin: false },
    { id: 'U_E_courses', label: 'Курсы английского', group: 'expense', behavior: 'temporary', endDate: '2026-12-31', builtin: false },
    { id: 'U_E_once', label: 'Крупные разовые', group: 'expense', behavior: 'excluded', builtin: false },
  ];
  let cls = s.settings.classification;
  const map: [string, string, 'income' | 'expense'][] = [['c-food', 'E_base', 'expense'], ['c-taxi', 'U_E_taxi', 'expense'], ['c-gifts', 'U_E_gifts', 'expense'], ['c-courses', 'U_E_courses', 'expense'], ['c-tv', 'U_E_once', 'expense'], ['c-sal', 'I_work', 'income']];
  for (const [c, k, kind] of map) cls = setCategoryClass(cls, cats.find((x) => x.id === c)!, k as OpClass, kind);
  return { ...s, imported: data, importedAt: TODAY, settings: { ...s.settings, classification: cls, classes: { custom, overrides: {}, ...extra } } };
}

describe('резерв и прогноз по поведению классов', () => {
  it('медиана базовых расходов = медиана месячной суммы всех базовых классов (продукты + такси)', () => {
    const o = buildOverview(longState(), TODAY);
    expect(o.baseline.median).toBe(tenge(70_000));
  });

  it('нерегулярный при 12+ месяцах истории — по факту: 100 000 / 12; медиана дала бы 0', () => {
    const st = longState();
    const ops = classifyAll(st.imported!, st.settings.classification).ops;
    expect(baselineMonthly(ops, TODAY, 'U_E_gifts' as OpClass, 6).median).toBe(tiyn(0));
    const { input, notes } = buildSimInput(st, TODAY);
    const gifts = input.expenses.find((e) => e.key === 'U_E_gifts')!;
    expect(gifts.monthly).toBe(tiyn(833_333)); // 10 000 000 тиын / 12
    // оценка была 240 000 в год — показываем разницу с фактом
    expect(notes.map((n) => n.text).join('\n')).toMatch(/оценка.*240\s000.*факт.*100\s000/i);
  });

  it('нерегулярный при истории меньше года — берётся оценка / 12', () => {
    const st = longState();
    st.imported = { ...st.imported!, operations: st.imported!.operations.filter((o) => o.date >= '2026-05-01') };
    const { input } = buildSimInput(st, TODAY);
    expect(input.expenses.find((e) => e.key === 'U_E_gifts')!.monthly).toBe(tenge(20_000));
  });

  it('нерегулярный без оценки и без года истории — средняя по полным месяцам (≥ 3) с предупреждением', () => {
    const st = longState();
    st.settings.classes.custom = st.settings.classes.custom.map((c) => (c.id === 'U_E_gifts' ? { ...c, annualEstimate: undefined } : c));
    st.imported = { ...st.imported!, operations: st.imported!.operations.filter((o) => o.date >= '2026-05-01') };
    const { input, warnings } = buildSimInput(st, TODAY);
    // май–сентябрь: 10 000 + 20 000 = 30 000 за 5 мес.
    expect(input.expenses.find((e) => e.key === 'U_E_gifts')!.monthly).toBe(tenge(6_000));
    expect(warnings.some((w) => w.code === 'plan.irregular_short')).toBe(true);
  });

  it('временный класс обрывается в свою дату', () => {
    const { input } = buildSimInput(longState(), TODAY);
    const courses = input.expenses.find((e) => e.key === 'U_E_courses')!;
    expect(courses).toMatchObject({ monthly: tenge(25_000), end: '2026-12-31' });
    const sim = simulate({ ...input, incomes: [], expenses: [courses], payments: [], goals: [] });
    expect(sim.months.find((m) => m.month === '2026-12')!.expenses).toBe(tenge(25_000));
    expect(sim.months.find((m) => m.month === '2027-01')!.expenses).toBe(tiyn(0));
  });

  it('вне прогноза и рассрочки в прогноз расходов не попадают; встроенные регулярные — по медиане', () => {
    const { input } = buildSimInput(longState(), TODAY);
    expect(input.expenses.map((e) => e.key).sort()).toEqual(['E_base', 'U_E_courses', 'U_E_gifts', 'U_E_taxi']);
  });

  it('временный класс с прошедшей датой в прогноз не попадает', () => {
    const st = longState();
    st.settings.classes.custom = st.settings.classes.custom.map((c) => (c.id === 'U_E_courses' ? { ...c, endDate: '2026-09-30' } : c));
    expect(buildSimInput(st, TODAY).input.expenses.some((e) => e.key === 'U_E_courses')).toBe(false);
  });
});

describe('совместимость состояния', () => {
  it('старый бэкап без классов читается с пустыми своими классами; разметка не теряется', () => {
    const st = longState();
    const raw = JSON.parse(serializeState(st, TODAY));
    delete raw.state.settings.classes;
    const back = parseState(JSON.stringify(raw));
    expect(back.ok).toBe(true);
    if (!back.ok) return;
    expect(back.value.settings.classes).toEqual(DEFAULT_CLASS_SETTINGS);
    expect(back.value.settings.classification).toEqual(st.settings.classification);
  });
  it('свои классы проходят через JSON-бэкап; дробная оценка отклоняется', () => {
    const st = longState();
    const back = parseState(serializeState(st, TODAY));
    expect(back.ok && back.value.settings.classes.custom.length).toBe(4);
    const raw = JSON.parse(serializeState(st, TODAY));
    raw.state.settings.classes.custom[1].annualEstimate = 1.5;
    expect(parseState(JSON.stringify(raw)).ok).toBe(false);
  });
});
