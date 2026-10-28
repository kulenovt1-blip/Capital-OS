/**
 * Свои виды дохода (D75): как свои классы — мастер с вопросами, поведение, которое меняет прогноз,
 * редактирование и удаление. Ожидания записаны до реализации; суммы посчитаны вручную в комментариях.
 */
import { describe, it, expect } from 'vitest';
import {
  BUILTIN_INCOME_KINDS, createIncomeKind, deleteIncomeKind, incomeKindDefaults, incomeKindPreview, incomeKindRegistry, kindBehavior,
  updateIncomeKind, validateIncomeItem,
} from '../../engine/income-kinds';
import { applyScenario, DEFAULT_SCENARIOS, type ScenarioPatch, type SimInput } from '../../engine/simulate';
import { DEFAULT_STRATEGY_SETTINGS } from '../../engine/allocate';
import { DEFAULT_SETTINGS, type Settings } from '../../engine/settings';
import { emptyState, parseState, serializeState } from '../../engine/state';
import { tenge } from '../../engine/money';
import { TODAY, worldGoals, worldProgress } from '../support/world';

const settings = (): Settings => structuredClone(DEFAULT_SETTINGS);
const adverse = (s: Settings): ScenarioPatch => s.scenarios.find((x) => x.id === 'adverse')!.patch;
const favorable = (s: Settings): ScenarioPatch => s.scenarios.find((x) => x.id === 'favorable')!.patch;

function sim(incomes: SimInput['incomes'], extra: Partial<SimInput> = {}): SimInput {
  return {
    start: TODAY, horizonMonths: 12, cash: tenge(0), deposits: [], liabilities: tenge(0), payments: [], incomes, expenses: [], events: [],
    goals: worldGoals(), progress: worldProgress(), strategy: { id: 'B' }, strategySettings: DEFAULT_STRATEGY_SETTINGS, baseMedian: tenge(100_000), ...extra,
  };
}

const FREELANCE = { label: 'Фриланс', dependsOnWork: false, pattern: 'varying' as const, adverseFactorBp: 4000, delayMonths: 0, ends: false };

describe('встроенные виды и поведение по сценарию', () => {
  it('три встроенных вида идут первыми, свои — после', () => {
    expect(BUILTIN_INCOME_KINDS.map((k) => k.id)).toEqual(['work', 'stable', 'irregular']);
    const s = createIncomeKind(FREELANCE, settings());
    expect(s.ok).toBe(true);
    if (!s.ok) return;
    expect(incomeKindRegistry(s.value.incomeKinds).map((k) => [k.id, k.builtin])).toEqual([['work', true], ['stable', true], ['irregular', true], ['K_frilans', false]]);
  });

  it('поведение по умолчанию в неблагоприятном: работа 80 % и задержка 3 мес., нерегулярный 0 %, стабильный 100 %', () => {
    const p = DEFAULT_SCENARIOS.find((x) => x.id === 'adverse')!.patch;
    expect(kindBehavior(p, 'work')).toEqual({ factorBp: 8000, delayMonths: 3 });
    expect(kindBehavior(p, 'irregular')).toEqual({ factorBp: 0, delayMonths: 0 });
    expect(kindBehavior(p, 'stable')).toEqual({ factorBp: 10000, delayMonths: 0 });
    // явная запись по виду сильнее старых полей
    expect(kindBehavior({ ...p, incomeFactorsBp: { work: 5000 }, incomeDelayMonths: { work: 1 } }, 'work')).toEqual({ factorBp: 5000, delayMonths: 1 });
  });
});

describe('мастер: значения по ответам', () => {
  it('зависит от работы — как у зарплаты; нерегулярный — 0 %; иначе 100 %', () => {
    const p = settings().scenarios.find((x) => x.id === 'adverse')!.patch;
    expect(incomeKindDefaults({ dependsOnWork: true, pattern: 'fixed' }, p)).toEqual({ adverseFactorBp: 8000, delayMonths: 3 });
    expect(incomeKindDefaults({ dependsOnWork: false, pattern: 'irregular' }, p)).toEqual({ adverseFactorBp: 0, delayMonths: 0 });
    expect(incomeKindDefaults({ dependsOnWork: false, pattern: 'varying' }, p)).toEqual({ adverseFactorBp: 10000, delayMonths: 0 });
  });

  it('превью: 40 000 ₸ в месяц → в неблагоприятном 16 000 ₸, от работы не зависит', () => {
    const lines = incomeKindPreview(FREELANCE, tenge(40_000)).join('\n').replace(/\s/g, ' ');
    expect(lines).toMatch(/40 000 ₸/);
    expect(lines).toMatch(/16 000 ₸/);
    expect(lines).toMatch(/от работы не зависит/i);
  });
});

describe('создание, изменение, удаление', () => {
  it('новый вид пишет своё поведение в неблагоприятный сценарий; доход этого вида считается по нему', () => {
    const r = createIncomeKind(FREELANCE, settings());
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(adverse(r.value).incomeFactorsBp).toMatchObject({ K_frilans: 4000 });
    // не зависит от работы — благоприятный сценарий его не трогает
    expect(favorable(r.value).incomeFactorsBp?.['K_frilans']).toBeUndefined();
    const i = applyScenario(sim([{ id: 'f', title: 'Заказы', amount: tenge(40_000), dayOfMonth: 10, kind: 'K_frilans' }], { incomeKindLabels: { K_frilans: 'Фриланс' } }), adverse(r.value));
    expect(i.incomes[0]!.amount).toBe(tenge(16_000));
    expect((i.scenarioNotes ?? []).join('\n').replace(/\s/g, ' ')).toMatch(/«Заказы».*Фриланс.*40 000 ₸ → 16 000 ₸ \(40 %\)/);
  });

  it('вид «зависит от работы» по умолчанию повторяет зарплату: задержка в неблагоприятном и рост в благоприятном', () => {
    const s0 = settings();
    const d = incomeKindDefaults({ dependsOnWork: true, pattern: 'fixed' }, s0.scenarios.find((x) => x.id === 'adverse')!.patch);
    const r = createIncomeKind({ label: 'Подработка', dependsOnWork: true, pattern: 'fixed', ...d, ends: false }, s0);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(kindBehavior(favorable(r.value), 'K_podrabotka')).toEqual({ factorBp: 11500, delayMonths: 0 });
    // доход, который ещё не начался, в неблагоприятном начинается на 3 месяца позже
    const i = applyScenario(sim([{ id: 'p', title: 'Подработка', amount: tenge(50_000), dayOfMonth: 1, kind: 'K_podrabotka', start: '2027-01-01' }]), adverse(r.value));
    expect(i.incomes[0]).toMatchObject({ amount: tenge(40_000), start: '2027-04-01' });
  });

  it('проверки: пустое и повторное название, процент и задержка в разумных пределах', () => {
    const r = createIncomeKind(FREELANCE, settings());
    if (!r.ok) throw new Error(r.error);
    expect(createIncomeKind({ ...FREELANCE, label: ' фриланс ' }, r.value)).toMatchObject({ ok: false });
    expect(createIncomeKind({ ...FREELANCE, label: 'Зависит от работы' }, settings())).toMatchObject({ ok: false });
    expect(createIncomeKind({ ...FREELANCE, label: '  ' }, settings())).toMatchObject({ ok: false });
    expect(createIncomeKind({ ...FREELANCE, label: 'X', adverseFactorBp: 30_001 }, settings())).toMatchObject({ ok: false });
    expect(createIncomeKind({ ...FREELANCE, label: 'X', adverseFactorBp: -1 }, settings())).toMatchObject({ ok: false });
    expect(createIncomeKind({ ...FREELANCE, label: 'X', delayMonths: 25 }, settings())).toMatchObject({ ok: false });
  });

  it('встроенный вид можно перенастроить: зарплата в плохом сценарии −50 % — 150 000 → 75 000', () => {
    const r = updateIncomeKind('work', { adverseFactorBp: 5000, delayMonths: 0 }, settings());
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const i = applyScenario(sim([{ id: 's', title: 'Зарплата', amount: tenge(150_000), dayOfMonth: 20, kind: 'work' }]), adverse(r.value));
    expect(i.incomes[0]!.amount).toBe(tenge(75_000));
    // название встроенного вида не меняется
    expect(updateIncomeKind('work', { label: 'Работа' }, settings())).toMatchObject({ ok: false });
  });

  it('свой вид меняется: название, поведение, «закончится ли»', () => {
    const r = createIncomeKind(FREELANCE, settings());
    if (!r.ok) throw new Error(r.error);
    const u = updateIncomeKind('K_frilans', { label: 'Заказы', adverseFactorBp: 2500, ends: true }, r.value);
    expect(u.ok).toBe(true);
    if (!u.ok) return;
    expect(u.value.incomeKinds[0]).toMatchObject({ id: 'K_frilans', label: 'Заказы', ends: true });
    expect(kindBehavior(adverse(u.value), 'K_frilans').factorBp).toBe(2500);
  });

  it('удалить нельзя встроенный и используемый вид; неиспользуемый удаляется вместе с записями в сценариях', () => {
    const r = createIncomeKind(FREELANCE, settings());
    if (!r.ok) throw new Error(r.error);
    expect(deleteIncomeKind('work', r.value)).toMatchObject({ ok: false });
    const used = { ...r.value, incomeSchedule: [{ id: 'i', title: 'Заказы', dayOfMonth: 10, amount: tenge(40_000), kind: 'K_frilans' }] };
    const refused = deleteIncomeKind('K_frilans', used);
    expect(refused.ok).toBe(false);
    if (!refused.ok) expect(refused.error).toMatch(/Заказы/);
    const d = deleteIncomeKind('K_frilans', r.value);
    expect(d.ok).toBe(true);
    if (!d.ok) return;
    expect(d.value.incomeKinds).toEqual([]);
    expect(adverse(d.value).incomeFactorsBp?.['K_frilans']).toBeUndefined();
  });

  it('вид «закончится» требует у дохода дату окончания', () => {
    const r = createIncomeKind({ ...FREELANCE, label: 'Грант', ends: true }, settings());
    if (!r.ok) throw new Error(r.error);
    const reg = incomeKindRegistry(r.value.incomeKinds);
    expect(validateIncomeItem({ id: 'g', title: 'Грант', dayOfMonth: 1, amount: tenge(10_000), kind: 'K_grant' }, reg).join()).toMatch(/дата окончания/i);
    expect(validateIncomeItem({ id: 'g', title: 'Грант', dayOfMonth: 1, amount: tenge(10_000), kind: 'K_grant', end: '2027-06-30' }, reg)).toEqual([]);
  });
});

describe('бэкап', () => {
  it('свои виды переживают JSON-бэкап; доход с неизвестным видом становится «стабильным»', () => {
    const r = createIncomeKind(FREELANCE, settings());
    if (!r.ok) throw new Error(r.error);
    const s = emptyState();
    s.settings = {
      ...r.value,
      incomeSchedule: [
        { id: 'a', title: 'Заказы', dayOfMonth: 10, amount: tenge(40_000), kind: 'K_frilans' },
        { id: 'b', title: 'Старое', dayOfMonth: 1, amount: tenge(1_000), kind: 'K_udalen' },
      ],
    };
    const p = parseState(serializeState(s));
    expect(p.ok).toBe(true);
    if (!p.ok) return;
    expect(p.value.settings.incomeKinds.map((k) => k.id)).toEqual(['K_frilans']);
    expect(p.value.settings.incomeSchedule.map((x) => x.kind)).toEqual(['K_frilans', 'stable']);
  });
});
