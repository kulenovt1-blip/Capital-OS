/**
 * Обзор (§10, экран 2) и состояние приложения с JSON-бэкапом (§12: «хранение только локально, с экспортом и импортом»).
 * Ожидаемые числа — из независимого расчёта SQL в scripts/make-fixtures.ts (synthetic.expected.json) и ручного счёта.
 */
import { describe, it, expect } from 'vitest';
import { buildOverview, nextIncomeDate } from '../../engine/overview';
import { emptyState, parseState, serializeState, STATE_VERSION, type AppState } from '../../engine/state';
import { importMmbackup } from '../../engine/import/mmbackup';
import { makeInstallment } from '../../engine/obligations';
import { DEFAULT_SETTINGS, mergeAccountSettings } from '../../engine/settings';
import { tenge, tiyn } from '../../engine/money';
import { fixtureBytes, fixtureJson } from '../support/fixtures';

const TODAY = '2026-10-28';
const expected = fixtureJson<{ balances: Record<string, number> }>('synthetic.expected.json');

function stateWithImport(): AppState {
  const data = importMmbackup(fixtureBytes('synthetic.mmbackup'));
  const s = emptyState();
  return { ...s, imported: data, importedAt: TODAY, settings: { ...s.settings, accounts: mergeAccountSettings([], data.accounts) } };
}

describe('обзор без данных', () => {
  it('пустое состояние: обзор строится, есть подсказка импортировать бэкап', () => {
    const o = buildOverview(emptyState(), TODAY);
    expect(o.hasData).toBe(false);
    expect(o.capital.gross).toBe(0);
    expect(o.notices.map((n) => n.code)).toContain('import.missing');
  });
});

describe('обзор на синтетическом бэкапе', () => {
  const o = buildOverview(stateWithImport(), TODAY);

  it('сверка прошла, капитал брутто = счета + сбережения вне приложения (технический счёт исключён)', () => {
    expect(o.reconcile!.ok).toBe(true);
    const savingsNet = 25_000_000 - 2_000_000; // 5 переводов по 50 000 ₸ минус снятие 20 000 ₸
    expect(o.capital.gross).toBe(tiyn(expected.balances['acc-kaspi']! + expected.balances['acc-cash']! + expected.balances['acc-halyk']! + savingsNet));
    expect(o.capital.receivables).toBe(tiyn(0)); // 10 000 выдал, 10 000 вернули
    expect(o.capital.liabilities.payablesFromOps).toBe(tenge(2_000)); // занял 5 000, вернул 3 000
  });

  it('неразмеченные категории → отчёт неполный и есть уведомление', () => {
    expect(o.classification!.complete).toBe(false);
    const n = o.notices.find((x) => x.code === 'unclassified')!;
    expect(n.level).toBe('warn');
    expect(n.text).toMatch(/Продукты/);
  });

  it('без расписания доходов горизонт = 30 дней, и это сказано явно', () => {
    expect(o.nextIncome).toEqual({ date: '2026-11-27', source: 'default' });
    expect(o.explanation.some((s) => s.code === 'overview.income_default')).toBe(true);
  });

  it('свободные деньги = ликвидно − резерв под платежи до следующего дохода', () => {
    const st = stateWithImport();
    st.obligations = [
      makeInstallment({ id: 'ob1', title: 'Телефон', owner: 'self', remaining: tenge(60_570), remainingAsOf: '2026-10-27', payment: tenge(30_285), firstDate: '2026-11-05' }),
    ];
    const r = buildOverview(st, TODAY);
    expect(r.upcoming30.map((u) => [u.date, u.amount])).toEqual([['2026-11-05', tenge(30_285)]]);
    expect(r.reserveUntilIncome).toBe(tenge(30_285));
    expect(r.freeMoney).toBe(tiyn(r.capital.liquidNow - tenge(30_285)));
  });
});

describe('следующий доход', () => {
  const s = { ...DEFAULT_SETTINGS, incomeSchedule: [
    { id: 'sal1', title: 'Зарплата', dayOfMonth: 5, amount: tenge(180_000) },
    { id: 'sal2', title: 'Аванс', dayOfMonth: 20, amount: tenge(90_000) },
    { id: 'st', title: 'Стипендия', dayOfMonth: 10, amount: tenge(38_000), end: '2027-06-30' },
  ] };
  it('ближайший по расписанию, строго после сегодня', () => {
    expect(nextIncomeDate(s, '2026-10-28')).toEqual({ date: '2026-11-05', source: 'schedule', title: 'Зарплата' });
    expect(nextIncomeDate(s, '2026-11-05')).toEqual({ date: '2026-11-10', source: 'schedule', title: 'Стипендия' });
  });
  it('поток после end не учитывается; до start — тоже', () => {
    expect(nextIncomeDate({ ...s, incomeSchedule: [s.incomeSchedule[2]!] }, '2027-07-01')).toEqual({ date: '2027-07-31', source: 'default' });
    expect(nextIncomeDate({ ...s, incomeSchedule: [{ ...s.incomeSchedule[0]!, start: '2027-01-01' }] }, '2026-10-28')).toEqual({ date: '2027-01-05', source: 'schedule', title: 'Зарплата' });
  });
});

describe('состояние: JSON-бэкап приложения', () => {
  it('экспорт → импорт даёт то же состояние, байт в байт при повторном экспорте', () => {
    const st = stateWithImport();
    const json = serializeState(st, TODAY);
    const back = parseState(json);
    expect(back.ok).toBe(true);
    if (!back.ok) return;
    expect(back.value).toEqual(st);
    expect(serializeState(back.value, TODAY)).toBe(json);
  });

  it('недостающие настройки дополняются дефолтами (старый бэкап)', () => {
    const raw = JSON.parse(serializeState(emptyState(), TODAY));
    delete raw.state.settings.reserveMonths;
    const back = parseState(JSON.stringify(raw));
    expect(back.ok && back.value.settings.reserveMonths).toBe(3);
  });

  it('чужой файл, мусор и бэкап из будущей версии отклоняются с объяснением', () => {
    expect(parseState('не json').ok).toBe(false);
    expect(parseState(JSON.stringify({ app: 'other', version: 1, state: {} })).ok).toBe(false);
    const future = parseState(JSON.stringify({ app: 'capital-os', version: STATE_VERSION + 1, state: {} }));
    expect(future.ok).toBe(false);
    if (!future.ok) expect(future.error).toMatch(/версии/);
  });

  it('сумма-дробь в бэкапе отклоняется (деньги только в целых тиынах)', () => {
    const raw = JSON.parse(serializeState(emptyState(), TODAY));
    raw.state.manualAccounts = [{ id: 'm', title: 'x', balance: 10.5, balanceDate: TODAY, liquidity: { kind: 'instant' }, comment: '' }];
    const back = parseState(JSON.stringify(raw));
    expect(back.ok).toBe(false);
  });
});
