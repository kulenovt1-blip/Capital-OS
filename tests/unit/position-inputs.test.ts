/**
 * T13 «Положение» v4: вводы человека — вид ручного актива (деньги / жильё и заблокированное), происхождение и надёжность дохода,
 * возраст и «хочу тратить в месяц», вопрос «Что обязательно?».
 *
 * Критерии плана: каждый ввод сохраняется, восстанавливается из резервной копии и влияет на расчёт ровно так, как описано;
 * пустой ввод = поведение «как раньше». Требования владельца к вводам активов (D138, 10.11): вопрос о виде — одним нажатием,
 * не указано = деньги; при сроке больше 30 дней предлагается «жильё / заблокировано»; про кредит спрашивается один раз,
 * когда добавляют жильё или машину. Ожидаемые значения посчитаны по этим формулировкам, не взяты из кода.
 */
import { describe, it, expect } from 'vitest';
import { emptyState, parseState, serializeState } from '../../engine/state';
import type { IncomeScheduleItem, ManualAccount } from '../../engine/settings';
import { incomeOrigin } from '../../engine/position/settings';
import {
  LOCKED_SUGGEST_DAYS,
  assetChoiceOf,
  daysUntilAvailable,
  essentialMarkupMissing,
  incomeOriginChoice,
  positionInputErrors,
  setIncomeOrigin,
  setIncomeStatus,
  shouldAskAboutLoan,
  suggestLockedAsset,
  withAssetChoice,
  withPositionInput,
} from '../../engine/position/inputs';
import { independenceOfState } from '../../engine/position/independence';
import { buildPositionSeries } from '../../engine/position/series';
import { incomeSourcesOf } from '../../engine/position/sources';
import { tenge } from '../../engine/money';
import { namedProfiles, TODAY } from '../support/position-profiles';

const STAMP = '2026-11-10';
const acc = (over: Record<string, unknown> = {}): ManualAccount =>
  ({ id: 'm1', title: 'Вклад вручную', balance: tenge(5_000), balanceDate: '2026-10-01', liquidity: { kind: 'instant' }, comment: '', ...over }) as ManualAccount;
const inc = (over: Record<string, unknown> = {}): IncomeScheduleItem =>
  ({ id: 'i1', title: 'Доход', dayOfMonth: 10, amount: tenge(100_000), kind: 'stable', ...over }) as IncomeScheduleItem;

describe('вид актива: два ответа вместо четырёх', () => {
  it('нет значения = деньги', () => {
    expect(assetChoiceOf(acc())).toBe('money');
    expect(assetChoiceOf(acc({ assetKind: 'securities' }))).toBe('money');
    expect(assetChoiceOf(acc({ assetKind: 'cash' }))).toBe('money');
    expect(assetChoiceOf(acc({ assetKind: 'non_investable' }))).toBe('locked');
  });

  it('«деньги» у счёта без значения ничего не добавляет: пустой ввод = как раньше', () => {
    const a = acc();
    const r = withAssetChoice(a, 'money');
    expect(r).toEqual(a);
    expect('assetKind' in r).toBe(false);
  });

  it('«деньги» не стирает прежний уточнённый вид (ценные бумаги остаются ценными бумагами)', () => {
    expect(withAssetChoice(acc({ assetKind: 'securities' }), 'money').assetKind).toBe('securities');
  });

  it('«жильё / заблокировано» ставит «неинвестируемое»; возврат на «деньги» убирает поле', () => {
    const locked = withAssetChoice(acc(), 'locked');
    expect(locked.assetKind).toBe('non_investable');
    const back = withAssetChoice(locked, 'money');
    expect('assetKind' in back).toBe(false);
  });

  it('исходный счёт не меняется (чистая функция)', () => {
    const a = acc();
    withAssetChoice(a, 'locked');
    expect('assetKind' in a).toBe(false);
  });
});

describe('срок, когда деньги можно снять', () => {
  it('сразу — 0 дней; через N дней — N; после даты — дней до неё, но не меньше 0', () => {
    expect(daysUntilAvailable({ kind: 'instant' }, '2026-11-10')).toBe(0);
    expect(daysUntilAvailable({ kind: 'days', days: 45 }, '2026-11-10')).toBe(45);
    expect(daysUntilAvailable({ kind: 'locked_until', date: '2026-12-10' }, '2026-11-10')).toBe(30);
    expect(daysUntilAvailable({ kind: 'locked_until', date: '2026-01-01' }, '2026-11-10')).toBe(0);
  });

  it('порог предложения — строго больше 30 дней (30 ещё «деньги»)', () => {
    expect(LOCKED_SUGGEST_DAYS).toBe(30);
    expect(suggestLockedAsset(acc({ liquidity: { kind: 'days', days: 30 } }), '2026-11-10')).toBe(false);
    expect(suggestLockedAsset(acc({ liquidity: { kind: 'days', days: 31 } }), '2026-11-10')).toBe(true);
    expect(suggestLockedAsset(acc({ liquidity: { kind: 'locked_until', date: '2026-12-10' } }), '2026-11-10')).toBe(false);
    expect(suggestLockedAsset(acc({ liquidity: { kind: 'locked_until', date: '2026-12-11' } }), '2026-11-10')).toBe(true);
  });

  it('сразу доступное не предлагается никогда', () => {
    expect(suggestLockedAsset(acc(), '2026-11-10')).toBe(false);
  });

  it('если человек уже ответил «жильё / заблокировано», предложение не повторяется', () => {
    expect(suggestLockedAsset(acc({ assetKind: 'non_investable', liquidity: { kind: 'days', days: 90 } }), '2026-11-10')).toBe(false);
  });
});

describe('вопрос про кредит или ипотеку: один раз', () => {
  it('новый актив «жильё / заблокировано» — спрашиваем', () => {
    expect(shouldAskAboutLoan(null, { assetKind: 'non_investable' })).toBe(true);
  });
  it('счёт «деньги» — не спрашиваем', () => {
    expect(shouldAskAboutLoan(null, {})).toBe(false);
    expect(shouldAskAboutLoan(null, { assetKind: 'deposit' })).toBe(false);
  });
  it('переключили существующий счёт с «деньги» на «жильё» — спрашиваем один раз', () => {
    expect(shouldAskAboutLoan({}, { assetKind: 'non_investable' })).toBe(true);
  });
  it('правка уже отвеченного жилья (оно и было «жильё») — не спрашиваем снова', () => {
    expect(shouldAskAboutLoan({ assetKind: 'non_investable' }, { assetKind: 'non_investable' })).toBe(false);
  });
});

describe('откуда доход: три ответа', () => {
  it('нет признаков = работа; по умолчанию доход не уходит в независимые поступления', () => {
    expect(incomeOriginChoice(inc())).toBe('labor');
    expect(incomeOrigin(inc())).toBe('labor');
  });

  it('«с моих накоплений» и «не с накоплений» читаются так же, как их читает расчёт независимости', () => {
    const fromAssets = setIncomeOrigin(inc(), 'from_assets');
    const independent = setIncomeOrigin(inc(), 'independent');
    expect(incomeOrigin(fromAssets)).toBe('from_assets');
    expect(incomeOrigin(independent)).toBe('independent');
    expect(incomeOriginChoice(fromAssets)).toBe('from_assets');
    expect(incomeOriginChoice(independent)).toBe('independent');
  });

  it('«работа» у дохода без признаков ничего не добавляет; у отмеченного — убирает оба признака', () => {
    const plain = inc();
    expect(setIncomeOrigin(plain, 'labor')).toEqual(plain);
    const back = setIncomeOrigin(setIncomeOrigin(plain, 'independent'), 'labor');
    expect('passive' in back).toBe(false);
    expect('fromAssets' in back).toBe(false);
  });

  it('смена происхождения не трогает остальные поля дохода', () => {
    const base = inc({ indexed: true, indexMonth: 3, start: '2026-01-01', end: '2030-01-01', status: 'T' });
    const r = setIncomeOrigin(base, 'independent');
    const { passive: _p, fromAssets: _f, ...rest } = r;
    expect(rest).toEqual(base);
  });
});

describe('надёжность дохода: ручной статус', () => {
  it('«определять самому» убирает переопределение; пустой ввод = как раньше', () => {
    const plain = inc();
    expect(setIncomeStatus(plain, 'auto')).toEqual(plain);
    const set = setIncomeStatus(plain, 'X');
    expect(set.status).toBe('X');
    expect('status' in setIncomeStatus(set, 'auto')).toBe(false);
  });
});

describe('возраст и «хочу тратить в месяц»', () => {
  it('пустой ввод — настроек нет вообще (ключ не хранится)', () => {
    expect(withPositionInput(undefined, { age: null, desiredMonthly: null })).toBeUndefined();
  });

  it('значения сохраняются как есть; очистка одного поля оставляет другое', () => {
    const a = withPositionInput(undefined, { age: 34, desiredMonthly: tenge(600_000) });
    expect(a).toEqual({ age: 34, desiredMonthly: tenge(600_000) });
    expect(withPositionInput(a, { age: null, desiredMonthly: tenge(600_000) })).toEqual({ desiredMonthly: tenge(600_000) });
    expect(withPositionInput(a, { age: 34, desiredMonthly: null })).toEqual({ age: 34 });
    expect(withPositionInput(a, { age: null, desiredMonthly: null })).toBeUndefined();
  });

  it('ошибки ввода: возраст вне 14–100, не целый; сумма не положительная', () => {
    expect(positionInputErrors({ age: null, desiredMonthly: null })).toEqual([]);
    expect(positionInputErrors({ age: 34, desiredMonthly: tenge(1) })).toEqual([]);
    expect(positionInputErrors({ age: 13, desiredMonthly: null })).toHaveLength(1);
    expect(positionInputErrors({ age: 101, desiredMonthly: null })).toHaveLength(1);
    expect(positionInputErrors({ age: 34.5, desiredMonthly: null })).toHaveLength(1);
    expect(positionInputErrors({ age: null, desiredMonthly: 0 as never })).toHaveLength(1);
    expect(positionInputErrors({ age: null, desiredMonthly: -5 as never })).toHaveLength(1);
  });
});

describe('«Что обязательно?»: когда вопрос нужен', () => {
  it('нужен, если данные есть, а базовых трат («без этого не прожить») нет', () => {
    expect(essentialMarkupMissing({ hasData: true, baseline: { median: 0 as never } })).toBe(true);
  });
  it('не нужен, если базовые траты уже размечены', () => {
    expect(essentialMarkupMissing({ hasData: true, baseline: { median: tenge(150_000) } })).toBe(false);
  });
  it('не нужен без данных: сначала импорт, а не разметка', () => {
    expect(essentialMarkupMissing({ hasData: false, baseline: { median: 0 as never } })).toBe(false);
  });
});

describe('вводы переживают резервную копию', () => {
  it('все новые вводы вместе: запись → чтение → запись даёт те же байты', () => {
    const s = emptyState();
    s.manualAccounts = [acc({ assetKind: 'non_investable', liquidity: { kind: 'locked_until', date: '2030-01-01' } }), acc({ id: 'm2', title: 'Деньги у родителей' })];
    s.settings.incomeSchedule = [setIncomeStatus(setIncomeOrigin(inc(), 'independent'), 'X'), inc({ id: 'i2', title: 'Зарплата' })];
    s.settings.position = withPositionInput(undefined, { age: 41, desiredMonthly: tenge(800_000) });
    const text = serializeState(s, STAMP);
    const r = parseState(text);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.manualAccounts.map((m) => assetChoiceOf(m))).toEqual(['locked', 'money']);
    expect(r.value.settings.incomeSchedule.map((x) => [incomeOriginChoice(x), x.status ?? null])).toEqual([['independent', 'X'], ['labor', null]]);
    expect(r.value.settings.position).toEqual({ age: 41, desiredMonthly: tenge(800_000) });
    expect(r.explanation.filter((e) => e.level === 'warn')).toEqual([]);
    expect(serializeState(r.value, STAMP)).toBe(text);
  });

  it('пустые вводы: состояние без новых полей не получает ни одного нового ключа', () => {
    const s = emptyState();
    s.manualAccounts = [withAssetChoice(acc(), 'money')];
    s.settings.incomeSchedule = [setIncomeStatus(setIncomeOrigin(inc(), 'labor'), 'auto')];
    s.settings.position = withPositionInput(undefined, { age: null, desiredMonthly: null });
    const text = serializeState(s, STAMP);
    expect(text).not.toContain('assetKind');
    expect(text).not.toContain('passive');
    expect(text).not.toContain('fromAssets');
    expect(text).not.toContain('"status"');
    expect(text).not.toContain('"position"');
  });
});

describe('вводы влияют на расчёт ровно так, как описано', () => {
  const base = () => namedProfiles().find((p) => p.name === 'B Работающий')!.state;
  const withManual = (kind: 'money' | 'locked') => {
    const s = base();
    return { ...s, manualAccounts: [...s.manualAccounts, withAssetChoice(acc({ id: 'big', title: 'Крупный актив', balance: tenge(40_000_000), balanceDate: TODAY }), kind)] };
  };

  it('«жильё / заблокировано» выводит актив из капитала для независимости, «деньги» — оставляет', () => {
    const noAsset = independenceOfState(base(), TODAY).capital;
    const money = independenceOfState(withManual('money'), TODAY).capital;
    const locked = independenceOfState(withManual('locked'), TODAY).capital;
    expect(money - noAsset).toBeCloseTo(40_000_000, 0);
    expect(locked).toBeCloseTo(noAsset, 6);
  });

  it('вид актива не меняет ряды положения (капитал нетто на 7 дат): жильё остаётся в капитале (вариант А, D138)', () => {
    const a = buildPositionSeries(withManual('money'), TODAY);
    const b = buildPositionSeries(withManual('locked'), TODAY);
    expect(b.netNow).toBe(a.netNow);
  });

  it('происхождение дохода «не с накоплений» + статус «постоянный» даёт независимые поступления; «работа» — нет', () => {
    const s = base();
    const item = inc({ id: 'rent', title: 'Аренда квартиры', amount: tenge(300_000), dayOfMonth: 5, indexed: true });
    const mk = (origin: 'labor' | 'from_assets' | 'independent') => ({ ...s, settings: { ...s.settings, incomeSchedule: [...s.settings.incomeSchedule, setIncomeOrigin(item, origin)] } });
    expect(independenceOfState(mk('independent'), TODAY).p).toBeGreaterThan(0);
    expect(independenceOfState(mk('from_assets'), TODAY).p).toBe(independenceOfState(mk('labor'), TODAY).p);
  });

  it('ручной статус «ожидаемый» не пускает доход в независимые поступления; статус отражается в источниках', () => {
    const s = base();
    const item = setIncomeOrigin(inc({ id: 'rent', title: 'Аренда', amount: tenge(300_000), dayOfMonth: 5, indexed: true }), 'independent');
    const mk = (status: 'auto' | 'X') => ({ ...s, settings: { ...s.settings, incomeSchedule: [...s.settings.incomeSchedule, setIncomeStatus(item, status)] } });
    const auto = mk('auto');
    const x = mk('X');
    expect(incomeSourcesOf(auto, TODAY).find((i) => i.id === 'rent')!.status).toBe('P');
    expect(incomeSourcesOf(x, TODAY).find((i) => i.id === 'rent')!.status).toBe('X');
    expect(independenceOfState(x, TODAY).p).toBeLessThan(independenceOfState(auto, TODAY).p);
  });

  it('возраст меняет только горизонт независимости: 90 − возраст в пределах 30–60', () => {
    const s = base();
    const at = (age: number | null) => independenceOfState({ ...s, settings: { ...s.settings, position: withPositionInput(undefined, { age, desiredMonthly: null }) } }, TODAY).horizon;
    expect(at(null)).toBe(50);
    expect(at(25)).toBe(60);
    expect(at(55)).toBe(35);
    expect(at(70)).toBe(30);
  });
});
