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
