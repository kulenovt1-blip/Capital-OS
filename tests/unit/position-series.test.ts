/**
 * T02 «Положение» v4: ряды (капитал подтверждённого слоя на 7 дат, потоки по месяцам, долг людям, долги, просрочки, ликвидность).
 *
 * Источники ожидаемых значений — НЕ код движка:
 *  1. tests/fixtures/position/series-reference.json — снят запуском series()/series4() из проб (127 синтетических профилей);
 *  2. ручной арифметикой на профиле B (доход 400 000, траты 260 000, остаток 140 000 в месяц, начальные 20 000) и A (рассрочка 150 000, платёж 25 000).
 * Различие с пробой, сделанное намеренно: там, где на дату данных ещё нет, ряд возвращает null, а не число (проба считала баланс 0).
 */
import { describe, it, expect } from 'vitest';
import { buildPositionSeries } from '../../engine/position/series';
import { emptyState, serializeState } from '../../engine/state';
import { tenge, type Money } from '../../engine/money';
import { fixtureJson } from '../support/fixtures';
import { acc, cat, dataset, exp, inc } from '../support/build';
import { mergeAccountSettings } from '../../engine/settings';
import { setCategoryClass } from '../../engine/classify';
import { makeInstallment } from '../../engine/obligations';
import { applyProbeOpts, build, probeProfiles, SPECS2, TODAY } from '../support/position-profiles';

interface Ref {
  family: string; histMonths: number; months: string[];
  inc: number[]; ex: number[]; free: number[]; instPaid: number[]; borrowedIn: number[]; repaidOut: number[];
  netNow: number; netNowC: number; netAgo: number[]; netAgoC: number[]; manualSum: number;
  payablesNow: number; payablesAgo: number[]; debtNow: number; debtAgo: number[]; overdueEntries: number; liquid: number;
}
const REF = fixtureJson<{ today: string; profiles: Record<string, Ref> }>('position/series-reference.json');
const profiles = probeProfiles();

describe('эталон проб: состав', () => {
  it('набор профилей в тесте совпадает с эталоном по именам (127)', () => {
    expect(profiles.map((p) => p.name).sort()).toEqual(Object.keys(REF.profiles).sort());
    expect(profiles.length).toBe(127);
  });
  it('дата эталона — дата проб', () => {
    expect(REF.today).toBe(TODAY);
  });
});

describe('ряды совпадают с пробой до тиына', () => {
  for (const p of profiles) {
    it(p.name, () => {
      const ref = REF.profiles[p.name]!;
      const s = buildPositionSeries(applyProbeOpts(p.state, p.opts), TODAY);
      expect(s.hasData).toBe(true);
      expect(s.histMonths).toBe(ref.histMonths);
      expect(s.months).toEqual(ref.months);
      expect(s.income).toEqual(ref.inc);
      expect(s.expense).toEqual(ref.ex);
      expect(s.free).toEqual(ref.free);
      expect(s.installmentsPaid).toEqual(ref.instPaid);
      expect(s.borrowed).toEqual(ref.borrowedIn);
      expect(s.borrowedBack).toEqual(ref.repaidOut);
      expect(s.netNow).toBe(ref.netNow);
      expect(s.netNow - (s.netConfirmed[0] as number)).toBe(ref.manualSum);
      expect(s.payables[0]).toBe(ref.payablesNow);
      expect(s.debt[0]).toBe(ref.debtNow);
      expect(s.overdueCount).toBe(ref.overdueEntries);
      expect(s.liquidNow).toBe(ref.liquid);
      expect(s.netConfirmed).toHaveLength(7);
      expect(s.debt).toHaveLength(7);
      expect(s.payables).toHaveLength(7);
      for (let h = 0; h <= 6; h++) {
        const has = h === 0 || h <= s.histMonths - 1; // на дату «конец месяца L−h» данные есть, если этот месяц не раньше первого
        if (!has) {
          expect(s.netConfirmed[h]).toBeNull();
          expect(s.debt[h]).toBeNull();
          expect(s.payables[h]).toBeNull();
          continue;
        }
        // Единственное намеренное отличие: долг людям не бывает ниже нуля (D60, как в `computeCapital`). Проба обрезала его только «сегодня»
        // (payablesNow), а на прошлые даты оставляла сырую сумму — см. тест «отличие от пробы ограничено» ниже.
        // Для «сегодня» (h = 0) проба берёт уже обрезанный долг из «Обзора» (payablesNow), поправки нет.
        const raw = h === 0 ? ref.payablesNow : ref.payablesAgo[h]!;
        const clamp = Math.max(0, raw) - raw;
        expect(s.netConfirmed[h], `netConfirmed[${h}]`).toBe(ref.netAgoC[h]! - clamp);
        expect(s.debt[h], `debt[${h}]`).toBe(ref.debtAgo[h]! + clamp);
        expect(s.payables[h], `payables[${h}]`).toBe(raw + clamp);
      }
    });
  }
});

describe('эталон содержит то, что нужно проверять', () => {
  const all = Object.values(REF.profiles);
  it('есть профили с долгом людям, просрочками, ручными активами и короткой историей', () => {
    expect(all.some((r) => r.payablesNow > 0)).toBe(true);
    expect(all.some((r) => r.payablesAgo.some((x) => x > 0))).toBe(true);
    expect(all.some((r) => r.overdueEntries > 0)).toBe(true);
    expect(all.some((r) => r.manualSum > 0)).toBe(true);
    expect(all.some((r) => r.histMonths < 7)).toBe(true);
  });
});

describe('отличие от пробы ограничено', () => {
  it('отрицательный долг людям в эталоне встречается только в двух профилях и не больше 5 000 ₸ (округление возвратов)', () => {
    const affected = Object.entries(REF.profiles).filter(([, r]) => r.payablesAgo.some((x) => x < 0));
    expect(affected.map(([n]) => n).sort()).toEqual(['oneBorrow2', 'oneBorrow3']);
    for (const [, r] of affected) {
      expect(r.payablesNow).toBe(0); // сама проба «сегодня» обрезает до нуля
      for (const x of r.payablesAgo) expect(x).toBeGreaterThanOrEqual(-tenge(5_000));
    }
  });
});

// ───────── ручная арифметика (профиль B) ─────────
// B: 12 месяцев сентябрь 2025 … август 2026 добавляют по 140 000 ₸ (доход 400 000 − траты 260 000), начальный остаток 20 000 ₸.
const B = () => build(SPECS2[1]!);
const net = (monthsOfSurplus: number, extra = 0): Money => tenge(20_000 + 140_000 * monthsOfSurplus + extra);

describe('даты ряда (профиль B, ручной расчёт)', () => {
  it('середина месяца: today = 15.08.2026 — последний полный месяц июль, капитал на конец месяцев июль−h', () => {
    const s = buildPositionSeries(B(), '2026-08-15');
    expect(s.lastMonth).toBe('2026-07');
    expect(s.dates).toEqual(['2026-08-15', '2026-06-30', '2026-05-31', '2026-04-30', '2026-03-31', '2026-02-28', '2026-01-31']);
    // сегодня: 11 месяцев (сен 2025 … июль 2026) + ещё август до 15-го: рента −120 000, питание −100 000, доход +400 000 (все до 15-го)
    expect(s.netConfirmed[0]).toBe(net(11, 400_000 - 120_000 - 100_000));
    expect(s.netConfirmed.slice(1)).toEqual([net(10), net(9), net(8), net(7), net(6), net(5)]);
    expect(s.histMonths).toBe(11);
    expect(s.months).toHaveLength(11);
    expect(s.months[0]).toBe('2025-09');
    expect(s.months[10]).toBe('2026-07');
    expect(s.income.every((x) => x === tenge(400_000))).toBe(true);
    expect(s.expense.every((x) => x === tenge(260_000))).toBe(true);
    expect(s.free.every((x) => x === tenge(140_000))).toBe(true);
  });

  it('1-е число: операции этого дня входят в «сегодня», месяц ещё не полный', () => {
    const s = buildPositionSeries(B(), '2026-03-01');
    expect(s.lastMonth).toBe('2026-02');
    expect(s.netConfirmed[0]).toBe(net(6, -120_000)); // сен…фев = 6 месяцев, 1 марта — аренда 120 000
    expect(s.netConfirmed[1]).toBe(net(5)); // конец января: сен…янв
    expect(s.histMonths).toBe(6);
  });

  it('последний день месяца и переход через год: today = 31.01.2026', () => {
    const s = buildPositionSeries(B(), '2026-01-31');
    expect(s.lastMonth).toBe('2025-12');
    expect(s.netConfirmed[0]).toBe(net(5)); // весь январь уже в операциях
    expect(s.netConfirmed.slice(1, 4)).toEqual([net(3), net(2), net(1)]); // конец ноября, октября, сентября
    expect(s.netConfirmed.slice(4)).toEqual([null, null, null]); // август 2025 и раньше — данных нет
    expect(s.histMonths).toBe(4);
    expect(s.months).toEqual(['2025-09', '2025-10', '2025-11', '2025-12']);
  });

  it('операции после today игнорируются (в потоках месяцев тоже)', () => {
    const s = buildPositionSeries(B(), '2025-12-10');
    expect(s.lastMonth).toBe('2025-11');
    expect(s.months).toEqual(['2025-09', '2025-10', '2025-11']);
    const full = buildPositionSeries(B(), '2026-01-01');
    expect(s.income).toEqual(full.income.slice(0, 3));
  });

  it('окно потоков — не больше 12 полных месяцев', () => {
    const s = buildPositionSeries(B(), TODAY);
    expect(s.months).toHaveLength(12);
    expect(s.months[0]).toBe('2025-11');
    expect(s.months[11]).toBe('2026-10');
    expect(s.histMonths).toBe(14); // сентябрь 2025 … октябрь 2026
  });

  it('данные только в текущем месяце: полных месяцев нет, ряды назад пусты, «сегодня» считается', () => {
    const s = buildPositionSeries(B(), '2025-09-15');
    expect(s.lastMonth).toBe('2025-08');
    expect(s.histMonths).toBe(0);
    expect(s.months).toEqual([]);
    expect(s.netConfirmed[0]).not.toBeNull();
    expect(s.netConfirmed.slice(1).every((x) => x === null)).toBe(true);
  });
});

describe('рассрочка (профиль A, ручной расчёт): долг на прошлые даты', () => {
  it('долг h месяцев назад = остаток сейчас + платежи за эти месяцы', () => {
    const A = build(SPECS2[0]!); // остаток 150 000 на 04.11.2026, платёж 25 000 каждый месяц с ноября 2025
    const s = buildPositionSeries(A, TODAY);
    expect(s.debt).toEqual([0, 1, 2, 3, 4, 5, 6].map((h) => tenge(150_000 + 25_000 * h)));
    expect(s.payables).toEqual([0, 0, 0, 0, 0, 0, 0]);
  });

  it('платёж в текущем (неполном) месяце после конца прошлого — тоже возвращается в долг прошлой даты', () => {
    const A = build(SPECS2[0]!);
    const extra = { ...A, imported: dataset({ accounts: A.imported!.accounts, categories: A.imported!.categories, operations: [...A.imported!.operations, exp('2026-11-02', 'card', 25_000, 'c_phone')] }) };
    const s = buildPositionSeries(extra, TODAY);
    expect(s.debt[0]).toBe(tenge(150_000)); // остаток введён «на сегодня» — уже после платежа
    expect(s.debt[1]).toBe(tenge(150_000 + 25_000 + 25_000)); // конец сентября: ещё и платёж за октябрь, и платёж 2 ноября
  });
});

// ───────── займы у людей, исключённые счета, корректировки ─────────
function tiny(extraOps: ReturnType<typeof inc>[] = [], tweak?: (s: ReturnType<typeof emptyState>) => void) {
  const cats = [cat('c_in', 'Доход', 'income'), cat('c_ex', 'Расход', 'expense'), cat('c_borrow', 'Беру в долг', 'income'), cat('c_back', 'Возвращаю долг', 'expense')];
  const ops = [
    inc('2026-06-05', 'a', 1_000, 'c_in'),
    exp('2026-07-10', 'a', 300, 'c_ex'),
    inc('2026-07-20', 'a', 500, 'c_borrow'),
    exp('2026-09-02', 'a', 200, 'c_back'),
    ...extraOps,
  ];
  const data = dataset({ accounts: [acc('a', 'Карта'), acc('b', 'Старая карта')], categories: cats, operations: ops });
  const s = emptyState();
  let cls = s.settings.classification;
  cls = setCategoryClass(cls, data.categories.find((c) => c.id === 'c_in')!, 'I_work', 'income');
  cls = setCategoryClass(cls, data.categories.find((c) => c.id === 'c_ex')!, 'E_base', 'expense');
  cls = setCategoryClass(cls, data.categories.find((c) => c.id === 'c_borrow')!, 'F_borrowed', 'income');
  cls = setCategoryClass(cls, data.categories.find((c) => c.id === 'c_back')!, 'F_borrowed_back', 'expense');
  const state = { ...s, imported: data, importedAt: '2026-10-15', settings: { ...s.settings, simpleMigrated: true, classification: cls, accounts: mergeAccountSettings([], data.accounts) } };
  tweak?.(state);
  return state;
}

describe('долг людям по датам (ручной расчёт)', () => {
  // today 15.10.2026 → L = сентябрь. Концы месяцев: сен 30 (h=1 → 31.08? нет: h=1 → конец августа).
  // dates: [15.10, 31.08, 31.07, 30.06, 31.05, 30.04, 31.03]
  it('взял 500 в июле, вернул 200 в сентябре', () => {
    const s = buildPositionSeries(tiny(), '2026-10-15');
    expect(s.dates.slice(0, 4)).toEqual(['2026-10-15', '2026-08-31', '2026-07-31', '2026-06-30']);
    expect(s.payables[0]).toBe(tenge(300)); // 500 − 200
    expect(s.payables[1]).toBe(tenge(500)); // конец августа: взято, ещё не возвращено
    expect(s.payables[2]).toBe(tenge(500)); // конец июля
    expect(s.payables[3]).toBe(0); // конец июня: ещё не брал
    expect(s.payables[4]).toBeNull(); // конец мая: данных ещё нет (первая операция в июне)
  });

  it('займ не увеличивает «подтверждённый» капитал: нетто = деньги − долг людям', () => {
    const s = buildPositionSeries(tiny(), '2026-10-15');
    // деньги: 1000 − 300 + 500 − 200 = 1000; долг людям 300 → нетто 700
    expect(s.netConfirmed[0]).toBe(tenge(700));
    // конец августа: деньги 1000 − 300 + 500 = 1200; долг людям 500 → 700
    expect(s.netConfirmed[1]).toBe(tenge(700));
    // конец июня: деньги 1000, долга нет → 1000
    expect(s.netConfirmed[3]).toBe(tenge(1_000));
  });

  it('чистая ликвидность = ликвидные − долг людям (не ниже нуля)', () => {
    const s = buildPositionSeries(tiny(), '2026-10-15');
    expect(s.liquidNow).toBe(tenge(1_000));
    expect(s.payables[0]).toBe(tenge(300));
    expect(s.netLiquid).toBe(tenge(700));
    // долг людям больше денег — не отрицательная
    const more = tiny([exp('2026-10-01', 'a', 900, 'c_ex')]);
    const s2 = buildPositionSeries(more, '2026-10-15');
    expect(s2.liquidNow).toBe(tenge(100));
    expect(s2.netLiquid).toBe(0);
  });

  it('вернул больше, чем занял (долг до начала учёта): долг не отрицательный, как в движке капитала', () => {
    const s = buildPositionSeries(tiny([exp('2026-09-20', 'a', 900, 'c_back')]), '2026-10-15');
    expect(s.payables[0]).toBe(0);
    expect(s.payables.every((x) => x === null || x >= 0)).toBe(true);
  });

  it('долги до начала учёта (openingDebts.payable) входят в долг людям на все даты', () => {
    const s = buildPositionSeries(tiny([], (st) => { st.settings.openingDebts = { receivable: 0 as Money, payable: tenge(100) }; }), '2026-10-15');
    expect(s.payables[0]).toBe(tenge(400));
    expect(s.payables[3]).toBe(tenge(100));
  });
});

describe('какие счета и корректировки входят', () => {
  it('исключённый из анализа счёт не входит ни в «сегодня», ни в прошлые даты', () => {
    const withB = tiny([inc('2026-06-06', 'b', 10_000, 'c_in')]);
    const before = buildPositionSeries(withB, '2026-10-15');
    expect(before.netConfirmed[0]).toBe(tenge(10_700));
    const excluded = tiny([inc('2026-06-06', 'b', 10_000, 'c_in')], (st) => { st.settings.accounts = st.settings.accounts.map((a) => (a.accountId === 'b' ? { ...a, excluded: true } : a)); });
    const after = buildPositionSeries(excluded, '2026-10-15');
    expect(after.netConfirmed[0]).toBe(tenge(700));
    expect(after.netConfirmed[3]).toBe(tenge(1_000));
  });

  it('корректировка учитывается начиная со своей даты', () => {
    const st = tiny([], (s) => { s.adjustments = [{ id: 'adj1', accountId: 'a', date: '2026-08-15', amount: tenge(50), comment: 'сверка' }]; });
    const s = buildPositionSeries(st, '2026-10-15');
    expect(s.netConfirmed[0]).toBe(tenge(750));
    expect(s.netConfirmed[1]).toBe(tenge(750)); // конец августа: корректировка уже была
    expect(s.netConfirmed[2]).toBe(tenge(700 + 0)); // конец июля: деньги 1000−300+500=1200, долг людям 500 → 700, корректировки ещё нет
  });

  it('ручные активы не входят в подтверждённый слой, но входят в netNow и в ликвидные', () => {
    const st = tiny([], (s) => { s.manualAccounts = [{ id: 'm1', title: 'Вклад вручную', balance: tenge(5_000), balanceDate: '2026-10-01', liquidity: { kind: 'instant' }, comment: 'вручную' }]; });
    const s = buildPositionSeries(st, '2026-10-15');
    expect(s.netConfirmed[0]).toBe(tenge(700));
    expect(s.netNow).toBe(tenge(5_700));
    expect(s.liquidNow).toBe(tenge(6_000));
  });
});

describe('доступно за 30 дней', () => {
  it('счёт с выводом за 20 дней входит в liquid30, но не в liquidNow; за 40 дней — не входит', () => {
    const mk = (days: number) =>
      tiny([], (s) => { s.manualAccounts = [{ id: 'm1', title: 'Вклад', balance: tenge(5_000), balanceDate: '2026-10-01', liquidity: { kind: 'days', days }, comment: 'вручную' }]; });
    const s20 = buildPositionSeries(mk(20), '2026-10-15');
    expect(s20.liquidNow).toBe(tenge(1_000));
    expect(s20.liquid30).toBe(tenge(6_000));
    const s40 = buildPositionSeries(mk(40), '2026-10-15');
    expect(s40.liquid30).toBe(tenge(1_000));
  });
});

describe('просрочки', () => {
  it('платежи по графику, которых нет в операциях, считаются просроченными', () => {
    const base = tiny();
    const ob = makeInstallment({ id: 'loan', title: 'Кредит', owner: 'self', remaining: tenge(900), remainingAsOf: '2026-07-31', payment: tenge(100), firstDate: '2026-08-10', match: { categoryIds: ['c_nothing'] } });
    const s = buildPositionSeries({ ...base, obligations: [ob] }, '2026-10-15');
    expect(s.overdueCount).toBe(3); // 10 августа, 10 сентября, 10 октября
  });
  it('без обязательств просрочек нет', () => {
    expect(buildPositionSeries(tiny(), '2026-10-15').overdueCount).toBe(0);
  });
});

describe('пустые и неполные данные', () => {
  it('пустое состояние: данных нет, ряды пусты, везде null или 0, исключений нет', () => {
    const s = buildPositionSeries(emptyState(), TODAY);
    expect(s.hasData).toBe(false);
    expect(s.histMonths).toBe(0);
    expect(s.months).toEqual([]);
    expect(s.income).toEqual([]);
    expect(s.netConfirmed).toEqual([null, null, null, null, null, null, null]);
    expect(s.debt).toEqual([null, null, null, null, null, null, null]);
    expect(s.payables).toEqual([null, null, null, null, null, null, null]);
    expect(s.liquidNow).toBe(0);
    expect(s.liquid30).toBe(0);
    expect(s.netLiquid).toBe(0);
    expect(s.overdueCount).toBe(0);
  });

  it('бэкап без операций', () => {
    const st = { ...emptyState(), imported: dataset({ accounts: [acc('a')], operations: [] }), importedAt: TODAY };
    const s = buildPositionSeries(st, TODAY);
    expect(s.hasData).toBe(false);
    expect(s.netConfirmed.every((x) => x === null)).toBe(true);
  });
});

describe('свойства', () => {
  it('все суммы — целые тиыны, ни одного NaN, на всех профилях проб', () => {
    for (const p of profiles) {
      const s = buildPositionSeries(applyProbeOpts(p.state, p.opts), TODAY);
      const all = [...s.income, ...s.expense, ...s.free, ...s.installmentsPaid, ...s.borrowed, ...s.borrowedBack, s.netNow, s.liquidNow, s.liquid30, s.netLiquid, ...s.netConfirmed, ...s.debt, ...s.payables].filter((x) => x !== null) as number[];
      for (const x of all) expect(Number.isSafeInteger(x), `${p.name}: ${x}`).toBe(true);
      expect(s.free).toEqual(s.income.map((x, i) => x - s.expense[i]!));
    }
  });

  it('функция чистая: состояние не меняется, повторный вызов даёт равный результат', () => {
    const st = applyProbeOpts(profiles[9]!.state, profiles[9]!.opts);
    const before = serializeState(st, '2026-11-04');
    const a = buildPositionSeries(st, TODAY);
    const b = buildPositionSeries(st, TODAY);
    expect(serializeState(st, '2026-11-04')).toBe(before);
    expect(b).toEqual(a);
  });

  it('порядок операций в бэкапе не влияет на результат', () => {
    const st = applyProbeOpts(profiles[2]!.state, profiles[2]!.opts);
    const reversed = { ...st, imported: { ...st.imported!, operations: [...st.imported!.operations].reverse() } };
    expect(buildPositionSeries(reversed, TODAY)).toEqual(buildPositionSeries(st, TODAY));
  });
});

// ───────── семейные рассрочки: история долга (D129) ─────────
// Профиль A: доход 90 000 в месяц, траты 40 000, платёж по рассрочке на телефон 25 000 с 17-го числа с ноября 2025, остаток 150 000 на 04.11.2026.
// Ручной расчёт долга на прошлую дату: остаток сегодня + платежи, сделанные после этой даты. За 6 месяцев (май–октябрь) платежей на 150 000.
// Капитал сегодня 270 000 (деньги 420 000 − долг 150 000); он растёт на 50 000 в месяц: 25 000 остаётся от дохода и 25 000 уходит на погашение долга.
describe('рассрочки: своя и семейная учитываются одинаково (D129)', () => {
  const ownState = () => build(SPECS2[0]!);
  const familyState = () => {
    const st = build(SPECS2[0]!);
    const phone = st.imported!.categories.find((c) => c.id === 'c_phone')!;
    return {
      ...st,
      settings: { ...st.settings, classification: setCategoryClass(st.settings.classification, phone, 'E_installment_family' as never, 'expense') },
      obligations: [makeInstallment({ id: 'ph', title: 'Телефон', owner: 'family', remaining: tenge(150_000), remainingAsOf: TODAY, payment: tenge(25_000), firstDate: '2026-11-17' })],
    };
  };
  const debts = [150_000, 175_000, 200_000, 225_000, 250_000, 275_000, 300_000].map((x) => tenge(x));
  const nets = [270_000, 220_000, 170_000, 120_000, 70_000, 20_000, -30_000].map((x) => tenge(x));

  it('своя рассрочка: долг и капитал на прошлые даты — по ручному расчёту', () => {
    const s = buildPositionSeries(ownState(), TODAY);
    expect(s.debt).toEqual(debts);
    expect(s.netConfirmed).toEqual(nets);
    expect(s.installmentsPaid).toEqual(Array(12).fill(tenge(25_000)));
    expect(s.installmentsFamilyPaid).toEqual(Array(12).fill(0));
  });

  it('семейная рассрочка с теми же платежами даёт тот же долг и тот же капитал: платежи возвращаются в долг на прошлые даты', () => {
    const s = buildPositionSeries(familyState(), TODAY);
    expect(s.debt).toEqual(debts);
    expect(s.netConfirmed).toEqual(nets);
    expect(s.installmentsPaid).toEqual(Array(12).fill(0));
    expect(s.installmentsFamilyPaid).toEqual(Array(12).fill(tenge(25_000)));
  });

  it('рост капитала за 6 месяцев при семейной рассрочке — 50 000 в месяц, а не 25 000 (до исправления погашение долга пропадало)', () => {
    const s = buildPositionSeries(familyState(), TODAY);
    expect((s.netConfirmed[0]! - s.netConfirmed[6]!) / 6).toBe(tenge(50_000));
  });

  it('у профилей проб (только свои рассрочки) ряды не изменились — эталон выше проходит без поправок', () => {
    expect(profiles.some((p) => buildPositionSeries(applyProbeOpts(p.state, p.opts), TODAY).installmentsFamilyPaid.some((x) => x !== 0))).toBe(false);
  });
});
