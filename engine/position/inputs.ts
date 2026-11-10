/**
 * «Положение» v4 (T13): чистые правила для вводов человека. Экраны только рисуют поля и вызывают эти функции, чтобы то, что человек
 * нажал, превращалось в данные одним и тем же способом и это можно было проверить тестами без интерфейса.
 *
 * Общий принцип: пустой ввод = поведение «как раньше». Ни одна функция не добавляет поле, если ответ — «по умолчанию»; состояние без новых
 * вводов остаётся байт в байт прежним. Математика положения здесь не меняется: файл только готовит данные для уже написанных расчётов.
 */
import { daysBetween, type IsoDate } from '../date';
import { isMoney, type Money } from '../money';
import type { IncomeScheduleItem, Liquidity, ManualAccount } from '../settings';
import {
  POSITION_AGE_MAX,
  POSITION_AGE_MIN,
  assetKindOf,
  incomeOrigin,
  normalizePositionSettings,
  type AssetKind,
  type IncomeOrigin,
  type IncomeStatus,
  type PositionSettings,
} from './settings';

// ───────────────────────── вид ручного актива ─────────────────────────

/**
 * Вопрос о виде актива — один, с двумя ответами (решение владельца 10.11, D138):
 *  money  — деньги: наличные, вклад, ценные бумаги; входят в капитал, из которого можно жить;
 *  locked — жильё, машина, заблокированное: остаётся в «Всего капитал», но в «Деньги, которые можно потратить» и в независимость не входит.
 * Уточнённый вид денег (наличные / вклад / ценные бумаги) на расчёт не влияет (D137) и этим вопросом не спрашивается.
 */
export type AssetChoice = 'money' | 'locked';

export const assetChoiceOf = (a: { assetKind?: AssetKind }): AssetChoice => (assetKindOf(a) === 'non_investable' ? 'locked' : 'money');

/**
 * Применяет ответ к счёту, не меняя остальное. «Деньги» у счёта, где вид не указан или уже «деньги», ничего не добавляет и не стирает
 * (прежний уточнённый вид сохраняется); возврат с «жильё» на «деньги» убирает поле — так счёт снова «как раньше».
 */
export function withAssetChoice<T extends { assetKind?: AssetKind }>(a: T, choice: AssetChoice): T {
  if (choice === 'locked') return a.assetKind === 'non_investable' ? a : { ...a, assetKind: 'non_investable' };
  if (a.assetKind !== 'non_investable') return a;
  const { assetKind: _dropped, ...rest } = a;
  void _dropped;
  return rest as T;
}

/** Сколько дней до того, как деньги можно снять: «сразу» — 0, «через N дней» — N, «после даты» — дней до неё (не меньше 0). */
export function daysUntilAvailable(l: Liquidity, today: IsoDate): number {
  if (l.kind === 'instant') return 0;
  if (l.kind === 'days') return Math.max(0, l.days);
  return Math.max(0, daysBetween(today, l.date));
}

/** Порог предложения «жильё / заблокировано»: дольше этого срока деньги уже нельзя считать запасом. Совпадает с горизонтом `K` (K_HORIZON_DAYS = 30). */
export const LOCKED_SUGGEST_DAYS = 30;

/**
 * Предлагать ли человеку отметить счёт как «жильё / заблокировано»: счёт числится деньгами, а снять их можно не раньше чем через
 * `LOCKED_SUGGEST_DAYS` дней. Только предложение — решает человек; ответ «деньги» остаётся ответом.
 */
export function suggestLockedAsset(a: Pick<ManualAccount, 'liquidity' | 'assetKind'>, today: IsoDate): boolean {
  return assetChoiceOf(a) === 'money' && daysUntilAvailable(a.liquidity, today) > LOCKED_SUGGEST_DAYS;
}

/**
 * Спрашивать ли «есть кредит или ипотека на это?»: когда актив становится «жильём / заблокированным» — при добавлении или при смене ответа.
 * Правка уже отвеченного актива вопрос не повторяет, поэтому отдельно хранить «спрашивали» не нужно.
 */
export function shouldAskAboutLoan(prev: { assetKind?: AssetKind } | null, next: { assetKind?: AssetKind }): boolean {
  return assetChoiceOf(next) === 'locked' && (prev === null || assetChoiceOf(prev) !== 'locked');
}

// ───────────────────────── доход: откуда и насколько надёжен ─────────────────────────

/**
 * Откуда доход — три ответа вместо двух флагов:
 *  labor       — работа или не отмечено: потеря работы = потеря дохода;
 *  from_assets — проценты, дивиденды с моих накоплений: капитал уже учтён отдельно, второй раз доход не считается;
 *  independent — пенсия, аренда, пособие, не с моих накоплений: считается независимым поступлением.
 */
export const incomeOriginChoice = (x: { passive?: boolean; fromAssets?: boolean }): IncomeOrigin => incomeOrigin(x);

export function setIncomeOrigin<T extends Pick<IncomeScheduleItem, 'passive' | 'fromAssets' | 'inHistory'>>(x: T, origin: IncomeOrigin): T {
  if (origin === 'labor') {
    if (!('passive' in x) && !('fromAssets' in x) && !('inHistory' in x)) return x;
    const { passive: _p, fromAssets: _f, inHistory: _h, ...rest } = x;
    void _p;
    void _f;
    void _h;
    return rest as T;
  }
  return { ...x, passive: true, fromAssets: origin === 'from_assets' };
}

/** Ручной статус надёжности дохода; `auto` — «определять самому»: переопределение убирается. */
export function setIncomeStatus<T extends Pick<IncomeScheduleItem, 'status'>>(x: T, status: IncomeStatus | 'auto'): T {
  if (status === 'auto') {
    if (!('status' in x)) return x;
    const { status: _s, ...rest } = x;
    void _s;
    return rest as T;
  }
  return { ...x, status };
}

// ───────────────────────── возраст и желаемые расходы ─────────────────────────

export interface PositionInput {
  age: number | null;
  desiredMonthly: Money | null;
}

/** Проверка ввода: возраст — целое от 14 до 100; сумма — целая положительная. Пустое — не ошибка. */
export function positionInputErrors(i: PositionInput): string[] {
  const errs: string[] = [];
  if (i.age !== null && !(Number.isInteger(i.age) && i.age >= POSITION_AGE_MIN && i.age <= POSITION_AGE_MAX)) errs.push(`Возраст — целое число от ${POSITION_AGE_MIN} до ${POSITION_AGE_MAX}`);
  if (i.desiredMonthly !== null && !(isMoney(i.desiredMonthly) && i.desiredMonthly > 0)) errs.push('Желаемые траты — сумма больше нуля');
  return errs;
}

/** Настройки положения после ввода. Пустое поле убирается; если не осталось ничего — настроек нет вовсе (ключ не хранится). */
export function withPositionInput(_prev: PositionSettings | undefined, i: PositionInput): PositionSettings | undefined {
  return normalizePositionSettings({
    ...(i.age !== null ? { age: i.age } : {}),
    ...(i.desiredMonthly !== null ? { desiredMonthly: i.desiredMonthly } : {}),
  }).value;
}

// ───────────────────────── «Что обязательно?» ─────────────────────────

/**
 * Нужен ли вопрос «Что из этого обязательно?»: данные есть, а ни одна трата не отмечена как «без этого не прожить». Тогда необходимый месяц
 * состоит из одних платежей по долгам, и запас по необходимому выглядит лучше, чем есть. Без данных вопрос не задаётся: сначала нужен импорт.
 */
export function essentialMarkupMissing(o: { hasData: boolean; baseline: { median: Money } }): boolean {
  return o.hasData && !(o.baseline.median > 0);
}
