/**
 * «Положение» v4 (T01): необязательные настройки человека, нужные только расчёту положения.
 *  - возраст — влияет лишь на горизонт расчёта независимости (90 − возраст, 30–60 лет) и больше ни на что;
 *  - «хочу тратить в месяц» — используется только в личном сценарии «При желаемых расходах» и в уровень не входит.
 * Обе настройки необязательны: пустое значение — поведение «как раньше». Состояния гистерезиса здесь нет (решение 7).
 */
import { isMoney, type Money } from '../money';
import { step, type ExplainStep } from '../explain';

export interface PositionSettings {
  /** Полных лет. Необязательно. */
  age?: number;
  /** Сколько человек хочет тратить в месяц, целые тиыны. Необязательно; только личный сценарий. */
  desiredMonthly?: Money;
}

/** Границы возраста: за ними значение считается опиской и отбрасывается. Техническая проверка ввода, не модель. */
export const POSITION_AGE_MIN = 14;
export const POSITION_AGE_MAX = 100;

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

/**
 * Приводит прочитанное из бэкапа к допустимому виду. Недопустимое значение отбрасывается с предупреждением,
 * остальное остаётся; если ничего не осталось — значения нет (ключ в состоянии не хранится, старые бэкапы читаются как раньше).
 * Лишние ключи не переносятся. Функция идемпотентна: повторный вызов на результате не даёт предупреждений.
 */
export function normalizePositionSettings(raw: unknown): { value: PositionSettings | undefined; warnings: ExplainStep[] } {
  if (raw === undefined || raw === null) return { value: undefined, warnings: [] };
  if (!isObj(raw)) {
    return { value: undefined, warnings: [step('position.dropped', 'Настройки положения в бэкапе повреждены и пропущены', { level: 'warn' })] };
  }
  const value: PositionSettings = {};
  const warnings: ExplainStep[] = [];

  const age = raw.age;
  if (age !== undefined && age !== null) {
    if (typeof age === 'number' && Number.isInteger(age) && age >= POSITION_AGE_MIN && age <= POSITION_AGE_MAX) value.age = age;
    else warnings.push(step('position.age.dropped', `Возраст в бэкапе пропущен: ожидается целое число от ${POSITION_AGE_MIN} до ${POSITION_AGE_MAX}`, { level: 'warn' }));
  }

  const desired = raw.desiredMonthly;
  if (desired !== undefined && desired !== null) {
    if (isMoney(desired) && desired > 0) value.desiredMonthly = desired;
    else warnings.push(step('position.desiredMonthly.dropped', 'Желаемые расходы в бэкапе пропущены: ожидается целая положительная сумма', { level: 'warn' }));
  }

  return { value: value.age === undefined && value.desiredMonthly === undefined ? undefined : value, warnings };
}

/**
 * Статус источника дохода (T03). Обычно выводится из данных (`engine/position/sources.ts`):
 *  P — подтверждённый постоянный (в расписании, не нерегулярный, конца нет в ближайшие 12 месяцев);
 *  T — подтверждённый временный (в расписании, конец в ближайшие 12 месяцев);
 *  X — ожидаемый (появился из события «начало дохода» или «смена дохода»);
 *  I — нерегулярный.
 * Человек может переопределить статус источника в расписании (например, «зарплата на испытательном сроке — ожидаемая»).
 */
export type IncomeStatus = 'P' | 'T' | 'X' | 'I';
export const INCOME_STATUSES: readonly IncomeStatus[] = ['P', 'T', 'X', 'I'];
export const isIncomeStatus = (v: unknown): v is IncomeStatus => v === 'P' || v === 'T' || v === 'X' || v === 'I';

/**
 * Приводит переопределения статусов в расписании доходов к допустимому виду: недопустимое значение отбрасывается с предупреждением,
 * `null` — «нет переопределения» без предупреждения. Элементы без поля не пересоздаются. Идемпотентна.
 */
export function normalizeIncomeStatuses<T extends { title: string; status?: unknown }>(items: readonly T[]): { items: T[]; warnings: ExplainStep[] } {
  const warnings: ExplainStep[] = [];
  const out = items.map((x) => {
    if (!('status' in x)) return x;
    if (isIncomeStatus(x.status)) return x;
    if (x.status !== null && x.status !== undefined) warnings.push(step('income.status.dropped', `Статус дохода «${x.title}» в бэкапе пропущен: ожидается P, T, X или I`, { level: 'warn' }));
    const { status: _dropped, ...rest } = x;
    void _dropped;
    return rest as T;
  });
  return { items: out, warnings };
}

/**
 * Вид актива ручного счёта (T04). Нужен только расчёту независимости (T10) и показателю капитала: от вида зависит безопасная ставка изъятия
 * (спецификация 10.3): ценные бумаги — выше, вклад — ниже, наличные — ноль. «Неинвестируемое» (недвижимость для жилья, закрытые активы) в капитал для
 * изъятия не входит. На прогноз и ряды вид не влияет.
 * «Не указано» = вклад: самая консервативная из ставок, при которой деньги всё же считаются работающими.
 */
export type AssetKind = 'cash' | 'deposit' | 'securities' | 'non_investable';
export const ASSET_KINDS: readonly AssetKind[] = ['cash', 'deposit', 'securities', 'non_investable'];
export const DEFAULT_ASSET_KIND: AssetKind = 'deposit';
export const isAssetKind = (v: unknown): v is AssetKind => typeof v === 'string' && (ASSET_KINDS as readonly string[]).includes(v);

/** Вид актива счёта; нет значения — `DEFAULT_ASSET_KIND`. */
export const assetKindOf = (a: { assetKind?: AssetKind }): AssetKind => a.assetKind ?? DEFAULT_ASSET_KIND;

/**
 * Приводит виды активов в ручных счетах к допустимому виду: недопустимое значение отбрасывается с предупреждением,
 * `null` — «нет значения» без предупреждения. Счета без поля не пересоздаются. Идемпотентна.
 */
export function normalizeAssetKinds<T extends { title: string; assetKind?: unknown }>(items: readonly T[]): { items: T[]; warnings: ExplainStep[] } {
  const warnings: ExplainStep[] = [];
  const out = items.map((x) => {
    if (!('assetKind' in x)) return x;
    if (isAssetKind(x.assetKind)) return x;
    if (x.assetKind !== null && x.assetKind !== undefined) warnings.push(step('account.assetKind.dropped', `Вид актива счёта «${x.title}» в бэкапе пропущен: ожидается наличные, вклад, ценные бумаги или неинвестируемое`, { level: 'warn' }));
    const { assetKind: _dropped, ...rest } = x;
    void _dropped;
    return rest as T;
  });
  return { items: out, warnings };
}

/**
 * Происхождение дохода для независимых поступлений `P` (T04, спецификация 10.1):
 *  labor — доход от труда или не отмеченный как пассивный: в `P` не входит (потеря работы = потеря дохода);
 *  from_assets — пассивный доход с активов, которые уже считаются в капитале `K` (проценты, дивиденды): в `P` не входит, иначе капитал посчитан дважды;
 *  independent — пассивный и явно «не из этих активов» (пенсия, рента, аренда имущества вне капитала): входит в `P`.
 * «Не указано»: доход — от труда; пассивный без ответа про происхождение — с этих же активов (консервативно).
 */
export type IncomeOrigin = 'labor' | 'from_assets' | 'independent';
export function incomeOrigin(x: { passive?: boolean; fromAssets?: boolean }): IncomeOrigin {
  if (x.passive !== true) return 'labor';
  return x.fromAssets === false ? 'independent' : 'from_assets';
}

/** Множитель индексации для `P`: доход растёт вместе с ценами — 1; не растёт или не указано — 0,5 (гипотеза спецификации). */
export const incomeIndexFactor = (x: { indexed?: boolean }): number => (x.indexed === true ? 1 : 0.5);

/**
 * Приводит признаки «не зависит от труда» (`passive`) и «из этих активов» (`fromAssets`) в расписании доходов к допустимому виду:
 * не логическое значение отбрасывается с предупреждением, `null` — без предупреждения. Доходы без полей не пересоздаются. Идемпотентна.
 */
export function normalizeIncomeFlags<T extends { title: string; passive?: unknown; fromAssets?: unknown }>(items: readonly T[]): { items: T[]; warnings: ExplainStep[] } {
  const warnings: ExplainStep[] = [];
  const out = items.map((x) => {
    const hasP = 'passive' in x, hasF = 'fromAssets' in x;
    if (!hasP && !hasF) return x;
    const bad = (k: 'passive' | 'fromAssets') => k in x && typeof x[k] !== 'boolean';
    if (!bad('passive') && !bad('fromAssets')) return x;
    const rest: Record<string, unknown> = { ...x };
    for (const k of ['passive', 'fromAssets'] as const) {
      if (!bad(k)) continue;
      if (x[k] !== null && x[k] !== undefined) warnings.push(step(`income.${k}.dropped`, `Признак дохода «${x.title}» (${k === 'passive' ? 'не зависит от труда' : 'из этих активов'}) в бэкапе пропущен: ожидается да или нет`, { level: 'warn' }));
      delete rest[k];
    }
    return rest as T;
  });
  return { items: out, warnings };
}
