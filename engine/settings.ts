/**
 * Пользовательские настройки и ручные данные, которые живут в приложении (не в MoneyManager).
 * Все коэффициенты — здесь, с дефолтами. Никаких скрытых констант в расчётах.
 */
import type { Money } from './money';
import type { IsoDate } from './date';
import type { Account } from './types';
import { DEFAULT_CLASSIFICATION, type ClassificationSettings } from './classify';
import { DEFAULT_STRATEGY_SETTINGS, type StrategyId, type StrategySettings } from './ladder';
import { DEFAULT_SCENARIOS, type LifeEvent, type Scenario } from './simulate';
import { DEFAULT_CLASS_SETTINGS, type ClassSettings } from './classes';

export type Liquidity = { kind: 'instant' } | { kind: 'days'; days: number } | { kind: 'locked_until'; date: IsoDate };

export interface AccountSettings {
  accountId: string;
  /** Исключён из анализа (технический счёт). Не удаляется. */
  excluded: boolean;
  liquidity: Liquidity;
  /** Пользователь ответил на вопрос о счёте «не учитывать в балансе» (D58). */
  reviewed?: boolean;
  /** Весь неназначенный остаток счёта — за этой целью (D59). */
  boundGoalId?: string;
}

/** Долги, которые были до начала учёта в MoneyManager (D60). */
export interface OpeningDebts {
  /** Мне были должны. */
  receivable: Money;
  /** Я был должен. */
  payable: Money;
  /**
   * «Не знаю — считать 0» (D68): пользователь подтвердил, что сумма долгов до начала данных неизвестна.
   * Числа не меняются — отрицательный долг и так считается нулём (D60); закрывается только шаг настройки.
   */
  acknowledged?: boolean;
}

/** Куда уходили переводы на сбережения вне MoneyManager (класс T_savings_out, D61). */
export type SavingsFlowsSetting = (
  | { mode: 'estimate' }
  | { mode: 'manual'; manualAccountId: string }
  | { mode: 'ignore' }
) & {
  /** Пользователь сам выбрал режим (а не остался на умолчании) — шаг настройки закрыт. */
  confirmed?: boolean;
};

export interface DepositTerms {
  /** Годовая ставка в базисных пунктах: 1450 = 14,50%. */
  rateBp: number;
  capitalization: 'monthly' | 'daily';
}

/** Счёт вне MoneyManager — единственный вид ручного ввода (§3.5). */
export interface ManualAccount {
  id: string;
  title: string;
  balance: Money;
  balanceDate: IsoDate;
  liquidity: Liquidity;
  deposit?: DepositTerms;
  comment: string;
  /**
   * Сюда уходят переводы «на сбережения вне приложения» (T_savings_out / T_savings_in).
   * Операции после balanceDate прибавляются к балансу (DECISIONS D29).
   */
  receivesSavingsFlows?: boolean;
}

/** Разовая корректировка с обязательным комментарием. */
export interface Adjustment {
  id: string;
  accountId: string;
  date: IsoDate;
  amount: Money;
  comment: string;
}

export interface IncomeScheduleItem {
  id: string;
  title: string;
  /** День месяца поступления. */
  dayOfMonth: number;
  /** Ожидаемая сумма (TODO: подтвердить у пользователя). */
  amount: Money;
  start?: IsoDate;
  end?: IsoDate;
  /** Поведение в сценариях (D66): работа урезается и откладывается, нерегулярный — свой коэффициент, стабильный не меняется. */
  kind?: IncomeKind;
}

/** Вид дохода = поведение в прогнозе, а не метка (D66). */
export type IncomeKind = 'work' | 'stable' | 'irregular';
export const INCOME_KIND_LABELS: Record<IncomeKind, string> = {
  work: 'зависит от работы',
  stable: 'стабильный',
  irregular: 'нерегулярный',
};
export const INCOME_KIND_HINTS: Record<IncomeKind, string> = {
  work: 'Зарплата, подработка по найму. В неблагоприятном сценарии урезается и может начаться позже.',
  stable: 'Стипендия, пенсия, аренда, регулярный перевод. Сценарии его не меняют; если он закончится — укажи дату окончания.',
  irregular: 'Фриланс, премии, заказы. В прогнозе — средняя сумма, в неблагоприятном сценарии по умолчанию 0.',
};
/** Старые значения ('stipend', 'other', пусто) — это «стабильный». */
export function normalizeIncomeKind(k: unknown): IncomeKind {
  return k === 'work' || k === 'irregular' ? k : 'stable';
}

export interface Settings {
  classification: ClassificationSettings;
  accounts: AccountSettings[];
  /** Ручное название для категорий без title (по uid). */
  categoryLabels: Record<string, string>;
  /** Окно сопоставления платежа с графиком обязательства, дней. */
  matchWindowDays: number;
  /** Минимальный резерв в месяцах медианных базовых расходов. */
  reserveMonths: number;
  /** За сколько полных месяцев считать медиану базовых расходов. */
  baselineMonths: number;
  /** Горизонт до следующего дохода, если расписание не задано. */
  defaultIncomeHorizonDays: number;
  /** Пороги горизонта цели в месяцах: small ≤ [0], medium ≤ [1], long ≤ [2], иначе major. */
  horizonMonths: [number, number, number];
  /** Инфляция, б.п. годовых (параметр, §12). */
  inflationBp: number;
  incomeSchedule: IncomeScheduleItem[];
  /** Коэффициенты стратегий распределения (§5.2) — все здесь, без скрытых констант. */
  strategy: StrategySettings;
  /** Стратегия «текущего плана»: относительно неё считаются сдвиги дат и ею распределяется прирост в прогнозе. */
  planStrategy: StrategyId;
  /** Горизонт прогноза, месяцев. */
  simulationMonths: number;
  /** Сценарии: базовый, неблагоприятный, благоприятный (патчи редактируются). */
  scenarios: Scenario[];
  /** Плановые события жизни (переезд, аренда, выход на работу) — входят в базовый прогноз. */
  plannedEvents: LifeEvent[];
  /** Свои классы и изменённое поведение встроенных (D50). */
  classes: ClassSettings;
  openingDebts: OpeningDebts;
  savingsFlows: SavingsFlowsSetting;
  /** Находки автозаполнения рассрочек, отклонённые пользователем («это не рассрочка»), по ключу находки (D67). */
  dismissedInstallments: string[];
}

export const DEFAULT_SETTINGS: Settings = {
  classification: DEFAULT_CLASSIFICATION,
  accounts: [],
  categoryLabels: {},
  matchWindowDays: 15,
  reserveMonths: 3,
  baselineMonths: 6,
  defaultIncomeHorizonDays: 30,
  horizonMonths: [3, 12, 36],
  inflationBp: 1000,
  incomeSchedule: [],
  strategy: DEFAULT_STRATEGY_SETTINGS,
  planStrategy: 'B',
  simulationMonths: 36,
  scenarios: DEFAULT_SCENARIOS,
  plannedEvents: [],
  classes: DEFAULT_CLASS_SETTINGS,
  openingDebts: { receivable: 0 as Money, payable: 0 as Money },
  savingsFlows: { mode: 'estimate' },
  dismissedInstallments: [],
};

/** Счета с флагом MoneyManager «не учитывать в балансе», о которых пользователь ещё не ответил (D58). */
export function accountsNeedingReview(settings: readonly AccountSettings[], accounts: readonly Account[]): Account[] {
  const byId = new Map(settings.map((s) => [s.accountId, s]));
  return accounts.filter((a) => !a.removed && a.ignoreInBalance && !byId.get(a.id)?.reviewed);
}

/**
 * Настройки счетов после импорта: новые счета получают дефолты
 * (instant; excluded = ignoreInBalance из MoneyManager), существующие не трогаются.
 */
export function mergeAccountSettings(existing: AccountSettings[], accounts: Account[]): AccountSettings[] {
  const byId = new Map(existing.map((s) => [s.accountId, s]));
  const out = [...existing];
  for (const a of accounts) {
    if (a.removed || byId.has(a.id)) continue;
    out.push({ accountId: a.id, excluded: a.ignoreInBalance, liquidity: { kind: 'instant' } });
  }
  return out.sort((x, y) => (x.accountId < y.accountId ? -1 : 1));
}
