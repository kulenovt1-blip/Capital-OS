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
import type { IncomeKindDef } from './income-kinds';
import { DEFAULT_CLASS_SETTINGS, type ClassSettings } from './classes';
import type { AssetKind, IncomeStatus, PositionSettings } from './position/settings';

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
  /** «Для трат» (по умолчанию) или «копилка» — деньги копилок не входят в «Можно тратить» (D96). */
  kind?: AccountKind;
  /**
   * Годовая ставка по счёту из MoneyManager, б.п. (D119): undefined — не спрошено (в прогнозе процентов нет,
   * на «Прогнозе» вопрос, если банк уже начислял); 0 — человек ответил «не считать»; > 0 — проценты в прогнозе.
   */
  rateBp?: number;
}

export type AccountKind = 'spend' | 'savings';

/** Название похоже на копилку: копилка, накопления, сбережения, депозит, вклад, резерв. */
export const SAVINGS_TITLE_RE = /копил|накоп|сбереж|депоз|вклад|резерв|savings|deposit/i;

/**
 * Вид счёта (D96, D103): заданный человеком; без него — предположение: копилка, если счёт привязан к цели,
 * деньги не «сразу», это ручной вклад, оценка сбережений вне MoneyManager или название похоже на копилку
 * («Вклад», «Депозит», «Накопления»…); иначе — для трат. Предположение видно и меняется в «Счетах».
 */
export function accountKindOf(p: { accountId: string; source: string; liquidity: Liquidity; title?: string }, settings: readonly AccountSettings[], manual: readonly ManualAccount[] = []): AccountKind {
  return accountKindGuess(p, settings, manual).kind;
}

/** Вид счёта и задан ли он человеком (`confirmed`) или угадан приложением. */
export function accountKindGuess(p: { accountId: string; source: string; liquidity: Liquidity; title?: string }, settings: readonly AccountSettings[], manual: readonly ManualAccount[] = []): { kind: AccountKind; confirmed: boolean } {
  const s = settings.find((x) => x.accountId === p.accountId);
  if (s?.kind) return { kind: s.kind, confirmed: true };
  const guess = (k: AccountKind) => ({ kind: k, confirmed: false });
  if (s?.boundGoalId) return guess('savings');
  if (p.liquidity.kind !== 'instant') return guess('savings');
  if (p.source === 'savings_flow') return guess('savings');
  if (manual.find((m) => m.id === p.accountId)?.deposit) return guess('savings');
  if (p.title && SAVINGS_TITLE_RE.test(p.title)) return guess('savings');
  return guess('spend');
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
  /** Вид актива для «Положения» (T04): наличные / вклад / ценные бумаги / неинвестируемое. Нет значения — вклад. На прогноз не влияет. */
  assetKind?: AssetKind;
  /** Для жилья / заблокированного: какой кредит или ипотека (id обязательства) на этом активе. Только для подписи «моя доля» на Профиле; на расчёт не влияет. */
  loanId?: string;
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
  /**
   * Повышают ли этот доход каждый год вместе с ценами (D108). undefined — не спрошено: в прогнозе не растёт,
   * на «Прогнозе» висит вопрос. true — растёт на инфляцию раз в 12 месяцев; false — не растёт (это ответ человека).
   */
  indexed?: boolean;
  /** Месяц повышения (1–12), если человек его указал; иначе — по истории, без истории — январь (D119). */
  indexMonth?: number;
  /**
   * Ручное переопределение статуса источника для «Положения» (T03): P / T / X / I. Нет значения — статус выводится из данных
   * (`incomeSources`). На прогноз не влияет.
   */
  status?: IncomeStatus;
  /** Доход не зависит от труда (пенсия, рента, проценты, дивиденды) — для независимых поступлений `P` (T04). Нет значения — от труда. На прогноз не влияет. */
  passive?: boolean;
  /** Пассивный доход идёт с активов, уже учтённых в капитале (T04). `false` — «не из этих активов». Нет значения — с этих же активов. */
  fromAssets?: boolean;
  /** Эти деньги уже приходят на счета и видны в операциях MoneyManager (D170): ручная строка тогда не прибавляется к среднему доходу второй раз. Нет значения — не спрошено: строка прибавляется. */
  inHistory?: boolean;
}

/** Вид дохода = поведение в прогнозе, а не метка (D66). Встроенные — ниже; свои — id 'K_…' (D75). */
/** Что человек ответил про всплеск трат (D175). */
export type SpikeAnswer = { kind: 'never' } | { kind: 'yearly' } | { kind: 'custom'; annual: Money };

export type IncomeKind = 'work' | 'stable' | 'irregular' | `K_${string}`;
export const INCOME_KIND_LABELS: Record<'work' | 'stable' | 'irregular', string> = {
  work: 'зависит от работы',
  stable: 'стабильный',
  irregular: 'нерегулярный',
};
export const INCOME_KIND_HINTS: Record<'work' | 'stable' | 'irregular', string> = {
  work: 'Зарплата, подработка по найму. В неблагоприятном сценарии урезается и может начаться позже.',
  stable: 'Стипендия, пенсия, аренда, регулярный перевод. Сценарии его не меняют; если он закончится — укажи дату окончания.',
  irregular: 'Фриланс, премии, заказы. В прогнозе — средняя сумма, в неблагоприятном сценарии по умолчанию 0.',
};
/** Старые значения ('stipend', 'other', пусто) и удалённые свои виды — это «стабильный». */
export function normalizeIncomeKind(k: unknown, customIds: readonly string[] = []): IncomeKind {
  if (k === 'work' || k === 'irregular') return k;
  if (typeof k === 'string' && customIds.includes(k)) return k as IncomeKind;
  return 'stable';
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
  /** Курсы, введённые человеком: тенге за 1 единицу валюты счёта (D155). Нет курса — счёт в иной валюте не считается. */
  currencyRates?: Record<string, number>;
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
  /** Доходы с датой окончания, про которые человек ответил «ничего не изменится» (D108). */
  incomeEndsAnswered?: string[];
  /** Находки проверки здравого смысла (`SanityId`), про которые человек сказал «так задумано» (D122): плашка больше не показывается. */
  sanityAnswered?: string[];
  /** Из каких целей брать при нехватке денег, по порядку (D109). Не задано — вопрос на «Прогнозе». */
  drawOrder?: string[];
  /**
   * Ответы на вопросы о данных, которые прогноз раньше выбрасывал (D119). undefined — не спрошено (прогноз как раньше,
   * на «Прогнозе» вопрос); true / false — ответ человека.
   */
  /** Крупные траты сверх обычного месяца в классе повторятся (по id класса). */
  lumps?: Record<string, boolean>;
  /** Месяцы, итоги за которые человек уже закрыл на «Обзоре» (D184). */
  summarySeen?: string[];
  /** Ответы про всплески трат (D175), по id `классId@с~по`. */
  spikes?: Record<string, SpikeAnswer>;
  /** Когда текущие рассрочки кончатся, будут новые — как раньше. */
  newInstallments?: boolean;
  /** Учитывать поступления вне расписания (подарки деньгами, кешбэк, прочее). */
  extraIncome?: boolean;
  /** Свои классы и изменённое поведение встроенных (D50). */
  classes: ClassSettings;
  openingDebts: OpeningDebts;
  savingsFlows: SavingsFlowsSetting;
  /** Находки автозаполнения рассрочек, отклонённые пользователем («это не рассрочка»), по ключу находки (D67). */
  dismissedInstallments: string[];
  /** Свои виды дохода (D75); поведение в сценариях — в самих сценариях по id вида. */
  incomeKinds: IncomeKindDef[];
  /** Срок главного числа прогноза, месяцев (D96): 6 / 12 / 24 / 60. */
  forecastViewMonths?: number;
  /** «Сразу показывать подробности» (D96). */
  showDetails?: boolean;
  /** Поступления (id операций), про которые сказано «уже распределил» (D100). */
  handledIncomes?: string[];
  /** Категории дохода, про которые сказано «это не доход» (D96). */
  dismissedIncomes?: string[];
  /** Перенос на новую модель экранов сделан (D96). */
  simpleMigrated?: boolean;
  /** Какие месяцы брать для «обычных трат» (D113): последние (по умолчанию) или только без дохода от работы. Не задано — не спрошено. */
  baselineMode?: 'last' | 'no_work';
  /** Категории редких трат, про которые уже сказано «разовая» или «повторяется» (D110). */
  repeatAnswered?: string[];
  /** Первый запуск (3 шага) пройден или пропущен (D96). */
  firstRunDone?: boolean;
  /** Необязательные настройки расчёта «Положения» v4: возраст и «хочу тратить в месяц». Нет значения — нет ключа. */
  position?: PositionSettings;
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
  planStrategy: 'S',
  simulationMonths: 36,
  scenarios: DEFAULT_SCENARIOS,
  plannedEvents: [],
  classes: DEFAULT_CLASS_SETTINGS,
  openingDebts: { receivable: 0 as Money, payable: 0 as Money },
  savingsFlows: { mode: 'estimate' },
  dismissedInstallments: [],
  incomeKinds: [],
  forecastViewMonths: 12,
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
