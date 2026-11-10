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
