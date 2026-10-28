/**
 * Универсальность и понятность (28.10, второй разбор пользователя): виды доходов как поведение,
 * «долги на начало — не знаю», автозаполнение рассрочек по операциям, короткое «Как посчитано».
 * Ожидания записаны до реализации; суммы по синтетике посчитаны вручную в комментариях.
 */
import { describe, it, expect } from 'vitest';
import { applyScenario, DEFAULT_SCENARIOS, type SimInput } from '../../engine/simulate';
import { DEFAULT_STRATEGY_SETTINGS } from '../../engine/allocate';
import { emptyState, parseState, serializeState, type AppState } from '../../engine/state';
import { importMmbackup } from '../../engine/import/mmbackup';
import { mergeAccountSettings } from '../../engine/settings';
import { setupSteps } from '../../engine/setup';
import { buildOverview } from '../../engine/overview';
import { detectInstallments, remainingFromTerm, remainingFromLastDate, suggestionToObligation } from '../../engine/installment-detect';
import { makeInstallment } from '../../engine/obligations';
import { tenge, tiyn } from '../../engine/money';
import { fixtureBytes } from '../support/fixtures';
import { TODAY as WTODAY, worldGoals, worldProgress } from '../support/world';

const TODAY = '2026-10-28';

function imported(): AppState {
  const data = importMmbackup(fixtureBytes('synthetic.mmbackup'));
  const s = emptyState();
  return { ...s, imported: data, importedAt: TODAY, settings: { ...s.settings, accounts: mergeAccountSettings([], data.accounts) } };
}

function sim(extra: Partial<SimInput> = {}): SimInput {
  return {
    start: WTODAY,
    horizonMonths: 12,
    cash: tenge(0),
    deposits: [],
    liabilities: tenge(0),
    payments: [],
    incomes: [
      { id: 'salary', title: 'Зарплата', amount: tenge(150_000), dayOfMonth: 20, kind: 'work' },
      { id: 'rent', title: 'Аренда', amount: tenge(50_000), dayOfMonth: 1, kind: 'stable' },
      { id: 'free', title: 'Фриланс', amount: tenge(40_000), dayOfMonth: 10, kind: 'irregular' },
    ],
    expenses: [],
    events: [],
    goals: worldGoals(),
    progress: worldProgress(),
    strategy: { id: 'B' },
    strategySettings: DEFAULT_STRATEGY_SETTINGS,
    baseMedian: tenge(100_000),
    ...extra,
  };
}

describe('виды доходов — поведение, а не метка', () => {
  it('неблагоприятный сценарий по умолчанию: работа −20%, нерегулярный доход 0, стабильный не меняется', () => {
    const adverse = DEFAULT_SCENARIOS.find((s) => s.id === 'adverse')!;
    expect(adverse.patch.irregularIncomeFactorBp).toBe(0);
    const i = applyScenario(sim(), adverse.patch);
    const by = Object.fromEntries(i.incomes.map((x) => [x.id, x.amount]));
    expect(by).toEqual({ salary: tenge(120_000), rent: tenge(50_000), free: tenge(0) });
  });

  it('коэффициент работы не трогает нерегулярный доход, и наоборот', () => {
    const i = applyScenario(sim(), { workIncomeFactorBp: 5000, irregularIncomeFactorBp: 15000 });
    const by = Object.fromEntries(i.incomes.map((x) => [x.id, x.amount]));
    expect(by).toEqual({ salary: tenge(75_000), rent: tenge(50_000), free: tenge(60_000) });
  });

  it('старые бэкапы: «стипендия», «другое» и пустой вид становятся «стабильный»; работа остаётся работой', () => {
    const s = emptyState();
    s.settings.incomeSchedule = [
      { id: 'a', title: 'Стипендия', dayOfMonth: 10, amount: tenge(38_000), kind: 'stipend' as never },
      { id: 'b', title: 'Прочее', dayOfMonth: 1, amount: tenge(1_000), kind: 'other' as never },
      { id: 'c', title: 'Без вида', dayOfMonth: 1, amount: tenge(1_000) },
      { id: 'd', title: 'Зарплата', dayOfMonth: 5, amount: tenge(180_000), kind: 'work' },
    ];
    const r = parseState(serializeState(s));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.settings.incomeSchedule.map((x) => x.kind)).toEqual(['stable', 'stable', 'stable', 'work']);
  });

  it('старый сохранённый неблагоприятный сценарий без нового поля получает «нерегулярный доход 0»; свои сценарии не трогаются', () => {
    const s = emptyState();
    s.settings.scenarios = [
      { id: 'base', name: 'Базовый', patch: {} },
      { id: 'adverse', name: 'Неблагоприятный', patch: { workIncomeFactorBp: 7000 } },
      { id: 'my', name: 'Мой', patch: { workIncomeFactorBp: 9000 } },
    ];
    const r = parseState(serializeState(s));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.settings.scenarios.map((x) => x.patch)).toEqual([{}, { workIncomeFactorBp: 7000, irregularIncomeFactorBp: 0 }, { workIncomeFactorBp: 9000 }]);
  });
});

describe('долги на начало учёта: «не знаю»', () => {
  it('отрицательный долг: «не знаю — считать 0» закрывает шаг, капитал не меняется', () => {
    const st = imported();
    // убрали «занял 5 000» — остался только возврат 3 000: долг возник до начала учёта
    st.imported = { ...st.imported!, operations: st.imported!.operations.filter((o) => !(o.kind === 'income' && o.categoryId === 'cat-borrow')) };
    const before = buildOverview(st, TODAY).capital.net;
    expect(setupSteps(st, TODAY).find((s) => s.id === 'debts')!.done).toBe(false);
    st.settings.openingDebts = { ...st.settings.openingDebts, acknowledged: true };
    const step = setupSteps(st, TODAY).find((s) => s.id === 'debts')!;
    expect(step.done).toBe(true);
    expect(step.status).toMatch(/считается 0/);
    expect(buildOverview(st, TODAY).capital.net).toBe(before);
  });
});

describe('автозаполнение рассрочек по операциям', () => {
  // синтетика: «телефон» 30 285 ₸ 5-го и «мама» 15 000 ₸ 15-го, март–октябрь 2026 (по 8 платежей), категория «Рассрочка»
  it('находит обе рассрочки: платёж, день, число платежей, следующий платёж, поиск по тегу и категории', () => {
    const scan = detectInstallments(imported(), TODAY);
    expect(scan.suggestions.map((s) => s.key)).toEqual(['tag:телефон', 'tag:мама']);
    const phone = scan.suggestions[0]!;
    expect(phone).toMatchObject({
      title: 'Рассрочка «телефон»',
      owner: 'self',
      payment: tenge(30_285),
      dayOfMonth: 5,
      count: 8,
      firstDate: '2026-03-05',
      lastDate: '2026-10-05',
      nextDate: '2026-11-05',
      regular: true,
      uniform: true,
      match: { tags: ['телефон'], categoryIds: ['cat-installment'] },
    });
    // данные начинаются 01.03 — первый платёж мог быть не первым по рассрочке
    expect(phone.mayPredateData).toBe(true);
    expect(scan.suggestions[1]).toMatchObject({ payment: tenge(15_000), dayOfMonth: 15, nextDate: '2026-11-15' });
  });

  it('семейный тег делает рассрочку семейной', () => {
    const st = imported();
    st.settings.classification = { ...st.settings.classification, familyTags: ['мама'] };
    const mom = detectInstallments(st, TODAY).suggestions.find((s) => s.key === 'tag:мама')!;
    expect(mom.owner).toBe('family');
  });

  it('остаток по сроку: 12 мес., сделано 8 → осталось 4 × 30 285 = 121 140, последний платёж 05.02.2027', () => {
    const phone = detectInstallments(imported(), TODAY).suggestions[0]!;
    expect(remainingFromTerm(phone, 12)).toEqual({ ok: true, remaining: tenge(121_140), paymentsLeft: 4, lastDate: '2027-02-05' });
    // если до начала данных было ещё 2 платежа — их можно указать
    expect(remainingFromTerm(phone, 12, 10)).toEqual({ ok: true, remaining: tenge(60_570), paymentsLeft: 2, lastDate: '2026-12-05' });
    const done = remainingFromTerm(phone, 8);
    expect(done.ok).toBe(false);
  });

  it('остаток по дате последнего платежа: до 05.02.2027 включительно — 4 платежа', () => {
    const phone = detectInstallments(imported(), TODAY).suggestions[0]!;
    expect(remainingFromLastDate(phone, '2027-02-05')).toEqual({ ok: true, remaining: tenge(121_140), paymentsLeft: 4, lastDate: '2027-02-05' });
    expect(remainingFromLastDate(phone, '2026-10-01').ok).toBe(false);
  });

  it('заведённая из находки рассрочка: форма заполнена, находка исчезает, будущие платежи находятся', () => {
    const st = imported();
    const phone = detectInstallments(st, TODAY).suggestions[0]!;
    const ob = suggestionToObligation(phone, { id: 'ob-phone', remaining: tenge(121_140), today: TODAY });
    expect(ob).toMatchObject({ title: 'Рассрочка «телефон»', kind: 'installment', owner: 'self', remaining: tenge(121_140), remainingAsOf: TODAY, match: phone.match });
    expect(ob.schedule.map((e) => [e.date, e.amount])).toEqual([
      ['2026-11-05', tenge(30_285)],
      ['2026-12-05', tenge(30_285)],
      ['2027-01-05', tenge(30_285)],
      ['2027-02-05', tenge(30_285)],
    ]);
    st.obligations = [ob];
    expect(detectInstallments(st, TODAY).suggestions.map((s) => s.key)).toEqual(['tag:мама']);
  });

  it('отклонённая находка больше не предлагается', () => {
    const st = imported();
    st.settings.dismissedInstallments = ['tag:мама'];
    expect(detectInstallments(st, TODAY).suggestions.map((s) => s.key)).toEqual(['tag:телефон']);
  });

  it('закончившаяся рассрочка (последний платёж больше 40 дней назад) не предлагается', () => {
    expect(detectInstallments(imported(), '2027-01-01').suggestions).toEqual([]);
  });

  it('без тегов: группы по категории и сумме, поиск по общему комментарию, предупреждение про одну категорию', () => {
    const st = imported();
    st.imported = { ...st.imported!, operations: st.imported!.operations.map((o) => (o.categoryId === 'cat-installment' ? { ...o, tagIds: [] } : o)) };
    const s = detectInstallments(st, TODAY).suggestions;
    expect(s.map((x) => x.key)).toEqual(['cat:cat-installment:3028500', 'cat:cat-installment:1500000']);
    expect(s[0]!.match).toEqual({ categoryIds: ['cat-installment'], commentContains: 'Рассрочка телефон' });
    expect(s[0]!.warnings.join(' ')).toMatch(/тег/);
  });

  it('две рассрочки под одним тегом: два платежа в месяц — предупреждение, способ «по сроку» ненадёжен', () => {
    const st = imported();
    const phoneTag = st.imported!.tags.find((t) => t.name === 'телефон')!.id;
    st.imported = { ...st.imported!, operations: st.imported!.operations.map((o) => (o.categoryId === 'cat-installment' ? { ...o, tagIds: [phoneTag] } : o)) };
    const [s] = detectInstallments(st, TODAY).suggestions;
    expect(s!.count).toBe(16);
    expect(s!.regular).toBe(false);
    expect(s!.uniform).toBe(false);
    expect(s!.warnings.join(' ')).toMatch(/несколько платежей в месяц/);
    expect(remainingFromTerm(s!, 24).ok).toBe(false);
  });

  it('досрочная доплата: платёж по большинству — 30 285, суммы неравные — срок не используется', () => {
    const st = imported();
    const phoneTag = st.imported!.tags.find((t) => t.name === 'телефон')!.id;
    st.imported = {
      ...st.imported!,
      operations: st.imported!.operations.map((o) => (o.kind !== 'transfer' && o.tagIds.includes(phoneTag) && o.date === '2026-07-05' ? { ...o, amount: tenge(60_570) } : o)),
    };
    const phone = detectInstallments(st, TODAY).suggestions.find((s) => s.key === 'tag:телефон')!;
    expect(phone.payment).toBe(tenge(30_285));
    expect(phone.uniform).toBe(false);
    expect(remainingFromTerm(phone, 12).ok).toBe(false);
    expect(remainingFromLastDate(phone, '2027-02-05').ok).toBe(true);
  });

  it('проверка заведённой: фактический платёж отличается от графика — предложение обновить', () => {
    const st = imported();
    st.obligations = [
      makeInstallment({ id: 'ob', title: 'Телефон', owner: 'self', remaining: tenge(100_000), remainingAsOf: '2026-07-31', payment: tenge(25_000), firstDate: '2026-08-05', match: { tags: ['телефон'] } }),
    ];
    const checks = detectInstallments(st, TODAY).checks;
    expect(checks).toEqual([expect.objectContaining({ obligationId: 'ob', kind: 'amount', amount: tenge(30_285) })]);
    expect(checks[0]!.text).toMatch(/30\s285/);
  });

  it('проверка заведённой: два платежа по графику не найдены — возможно, закрыта досрочно', () => {
    const st = imported();
    st.obligations = [
      makeInstallment({ id: 'ob', title: 'Телефон', owner: 'self', remaining: tenge(121_140), remainingAsOf: TODAY, payment: tenge(30_285), firstDate: '2026-11-05', match: { tags: ['телефон'] } }),
    ];
    expect(detectInstallments(st, TODAY).checks).toEqual([]);
    const later = detectInstallments(st, '2027-01-10').checks;
    expect(later).toEqual([expect.objectContaining({ obligationId: 'ob', kind: 'stalled' })]);
  });

  it('«Обзор»: незаведённые рассрочки — предупреждение с кнопкой; шаг настройки закрыт, когда находок нет', () => {
    const st = imported();
    const o = buildOverview(st, TODAY);
    const n = o.notices.find((x) => x.code === 'installments.detected')!;
    expect(n.text).toMatch(/2/);
    expect(n.action).toMatchObject({ route: 'settings', section: 'obligations' });
    expect(setupSteps(st, TODAY).find((s) => s.id === 'obligations')!.done).toBe(false);
    st.settings.dismissedInstallments = ['tag:мама', 'tag:телефон'];
    expect(setupSteps(st, TODAY).find((s) => s.id === 'obligations')!.done).toBe(true);
  });
});

describe('«Как посчитано»: коротко по умолчанию', () => {
  it('нулевые слагаемые не перечисляются; второстепенные шаги помечены как подробности', () => {
    const o = buildOverview(imported(), TODAY);
    const by = (code: string) => o.capital.explanation.find((s) => s.code === code)!;
    // в синтетике обязательства — только долг по операциям 2 000 ₸
    // суммы форматируются с неразрывным пробелом — сравниваем с обычным
    expect(by('capital.liabilities').text.replace(/\s/g, ' ')).toBe('Обязательства 2 000 ₸ = долги по операциям 2 000 ₸');
    // Halyk = 0 ₸ — не в сумме, а одной припиской
    expect(by('capital.gross').text).not.toMatch(/Halyk/);
    expect(by('capital.gross').text).toMatch(/ещё 1 счёт с нулевым остатком/);
    expect(by('capital.receivables').detail).toBe(true);
    expect(by('capital.liquid').detail).toBe(true);
    expect(o.capital.explanation.filter((s) => s.code === 'capital.excluded').every((s) => s.detail)).toBe(true);
    const free = o.explanation.find((s) => s.code === 'overview.free')!;
    expect(free.text).not.toMatch(/\s0\s₸/);
    expect(free.detail).toBeFalsy();
  });

  it('сумма по правилу не меняется: числа те же, что и раньше', () => {
    const o = buildOverview(imported(), TODAY);
    expect(o.capital.liabilities.total).toBe(tiyn(200_000));
  });
});

describe('подсказка класса по названию категории — вместо зашитых названий одного человека', () => {
  it('частые названия получают подсказку, своё неизвестное — нет', async () => {
    const { suggestClassForCategory } = await import('../../engine/classify');
    expect(suggestClassForCategory('Депозит Halyk', 'expense')).toBe('T_savings_out');
    expect(suggestClassForCategory('Копилка', 'expense')).toBe('T_savings_out');
    expect(suggestClassForCategory('Снял с вклада', 'income')).toBe('T_savings_in');
    expect(suggestClassForCategory('Кредит на ноутбук', 'expense')).toBe('E_installment_own');
    expect(suggestClassForCategory('Зарплата', 'income')).toBe('I_work');
    expect(suggestClassForCategory('Стипендия', 'income')).toBe('I_stipend');
    expect(suggestClassForCategory('Продукты', 'expense')).toBe('E_base');
    expect(suggestClassForCategory('Аптека', 'expense')).toBe('E_health');
    expect(suggestClassForCategory('Занял у брата', 'income')).toBe('F_borrowed');
    expect(suggestClassForCategory('Вернул долг', 'expense')).toBe('F_borrowed_back');
    expect(suggestClassForCategory('Дал в долг', 'expense')).toBe('F_lent');
    expect(suggestClassForCategory('Мне вернули долг', 'income')).toBe('F_lent_back');
    expect(suggestClassForCategory('Хобби-мастерская', 'expense')).toBeNull();
  });
});

describe('цели: универсальный старт', () => {
  it('«Начать с резерва» — одна цель «Резерв» с суммой по правилу, без чужих целей', async () => {
    const { starterGoals, validateGoal } = await import('../../engine/goals');
    const g = starterGoals(TODAY);
    expect(g.map((x) => [x.title, x.role, x.targetRule?.kind])).toEqual([['Резерв', 'safety', 'months_of_base']]);
    expect(validateGoal(g[0]!, g)).toEqual([]);
  });
});
