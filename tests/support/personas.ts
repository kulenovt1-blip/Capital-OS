/**
 * Пять демо-персонажей «Примерь на себя» (docs/personas-spec: claude/personas-spec.md): синтетические бэкапы, прошедшие через настоящий движок.
 * Все цифры выдуманы, типичны для Казахстана в целом; реальные данные в репозиторий не попадают.
 * Ступени (целевые): Берик 1, Серик 2, Алия 3 (у границы 4), Олжас 4, Дантал 5. Проверяет `persona-levels.test.ts`.
 */
import type { AppState } from '../../engine/state';
import { tenge } from '../../engine/money';
import type { ManualAccount } from '../../engine/settings';
import { applyProbeOpts, build, TODAY, type Spec } from './position-profiles';

export const PERSONA_TODAY = TODAY;
export type PersonaId = 'berik' | 'serik' | 'aliya' | 'olzhas' | 'dantal';

export interface PersonaMeta {
  id: PersonaId;
  name: string;
  /** Одна строка о человеке для карточки выбора. */
  line: string;
  /** Целевая ступень (проверяется тестом). */
  level: 1 | 2 | 3 | 4 | 5;
}

export const PERSONAS: readonly PersonaMeta[] = [
  { id: 'berik', name: 'Берик', line: '29 лет. Потерял стабильную работу, подработки и неполная ставка; берёт новые займы, чтобы дотянуть до конца месяца.', level: 1 },
  { id: 'serik', name: 'Серик', line: '32 года. Стабильная зарплата, вовремя платит, закрывает рассрочку на телефон; запаса почти нет.', level: 2 },
  { id: 'aliya', name: 'Алия', line: '31 год. Хорошая зарплата и новая квартира в ипотеку; откладывает, подушка есть.', level: 3 },
  { id: 'olzhas', name: 'Олжас', line: '38 лет. Хорошая работа, своя квартира и машина, раз в год — отпуск; один источник дохода и крупный платёж.', level: 4 },
  { id: 'dantal', name: 'Дантал', line: 'Обеспечил себя на много лет вперёд; живёт на проценты и аренду.', level: 5 },
];

type Ex = Spec['expenses'][number];
const ex = (id: string, title: string, cls: Ex['cls'], amount: Ex['amount'], day: number): Ex => ({ id, title, cls, amount, day });

/** Жильё: актив, который нельзя снять за месяц; ипотека привязана к нему (на Профиле — «твоя доля»). */
const property = (title: string, value: number, loanId: string): ManualAccount =>
  ({ id: 'flat', title, balance: tenge(value), balanceDate: TODAY, liquidity: { kind: 'locked_until' as const, date: '2035-01-01' }, comment: 'введено вручную', assetKind: 'non_investable', loanId }) as ManualAccount;
/** Ценные бумаги: продаются за несколько дней. */
const securities = (title: string, value: number): ManualAccount =>
  ({ id: 'sec', title, balance: tenge(value), balanceDate: TODAY, liquidity: { kind: 'days' as const, days: 3 }, comment: 'введено вручную', assetKind: 'securities' }) as ManualAccount;

function berik(): AppState {
  const spec: Spec = {
    name: 'Берик', from: '2025-09', opening: 0,
    incomes: [
      { id: 'part', title: 'Подработки и неполная ставка', cls: 'I_work', day: 7, amount: 220_000, kind: 'irregular', sched: 220_000 },
      { id: 'newloan', title: 'Новый заём', cls: 'F_borrowed', day: 15, amount: 110_000, kind: 'irregular', sched: 0 },
    ],
    expenses: [
      ex('food', 'Еда', 'E_base', 90_000, 3), ex('rent', 'Жильё и связь', 'E_base', 110_000, 1), ex('fun', 'Развлечения', 'E_fun', 15_000, 20),
      ex('loan1', 'Кредит 1', 'E_installment_own', 70_000, 12), ex('loan2', 'Кредит 2', 'E_installment_own', 45_000, 18),
    ],
    debts: [{ id: 'cr', title: 'Кредиты', remaining: 1_900_000, payment: 115_000, firstDate: '2026-11-12' }],
  };
  return build(spec);
}

function serik(): AppState {
  return build({
    name: 'Серик', from: '2025-09', opening: 30_000,
    incomes: [{ id: 'job', title: 'Зарплата', cls: 'I_work', day: 5, amount: 330_000, kind: 'work', sched: 330_000 }],
    expenses: [ex('food', 'Еда', 'E_base', 100_000, 3), ex('rent', 'Аренда', 'E_base', 120_000, 1), ex('fun', 'Развлечения', 'E_fun', 30_000, 20), ex('inst', 'Рассрочка на телефон', 'E_installment_own', 35_000, 14)],
    debts: [{ id: 'ph', title: 'Рассрочка на телефон', remaining: 280_000, payment: 35_000, firstDate: '2026-11-14' }],
  });
}

const PROP = 26_000_000;
function aliya(): AppState {
  const st = build({
    name: 'Алия', from: '2025-09', opening: 1_100_000,
    incomes: [{ id: 'job', title: 'Зарплата', cls: 'I_work', day: 5, amount: 800_000, kind: 'work', sched: 800_000 }],
    expenses: [ex('food', 'Еда', 'E_base', 130_000, 3), ex('home', 'Коммунальные и связь', 'E_base', 60_000, 1), ex('fun', 'Рестораны и развлечения', 'E_fun', 90_000, 20), ex('mort', 'Ипотека', 'E_installment_own', 230_000, 10)],
    debts: [{ id: 'mort', title: 'Ипотека', remaining: 22_000_000, payment: 230_000, firstDate: '2026-11-10' }],
  });
  return applyProbeOpts(st, { manual: [property('Квартира', PROP, 'mort')] });
}

function olzhas(): AppState {
  return build({
    name: 'Олжас', from: '2025-09', opening: 9_000_000,
    incomes: [{ id: 'job', title: 'Зарплата', cls: 'I_work', day: 5, amount: 1_500_000, kind: 'work', sched: 1_500_000 }],
    expenses: [
      ex('food', 'Еда', 'E_base', 220_000, 3), ex('home', 'Коммунальные и связь', 'E_base', 90_000, 1), ex('fun', 'Развлечения', 'E_fun', 180_000, 20),
      ex('car', 'Автокредит', 'E_installment_own', 250_000, 12),
      ex('trip', 'Отпуск', 'E_other', (m) => (m === '2026-07' ? 900_000 : 0), 9),
    ],
    debts: [{ id: 'car', title: 'Автокредит', remaining: 7_000_000, payment: 250_000, firstDate: '2026-11-12' }],
  });
}

function dantal(): AppState {
  // вклады — на счёте-копилке, ценные бумаги — ручным активом; доход пассивный (проценты и аренда)
  const st = build({
    name: 'Дантал', from: '2025-09', opening: 150_000_000,
    incomes: [{ id: 'int', title: 'Проценты и аренда', cls: 'I_interest', day: 5, amount: 400_000, kind: 'stable', sched: 400_000 }],
    expenses: [ex('food', 'Еда', 'E_base', 150_000, 3), ex('home', 'Коммунальные и связь', 'E_base', 150_000, 1), ex('fun', 'Жизнь и путешествия', 'E_fun', 200_000, 20)],
    debts: [],
  });
  const withSec = applyProbeOpts(st, { manual: [securities('Ценные бумаги', 450_000_000)] });
  return { ...withSec, settings: { ...withSec.settings, incomeSchedule: withSec.settings.incomeSchedule.map((i) => ({ ...i, passive: true as const })) } };
}

const BUILDERS: Record<PersonaId, () => AppState> = { berik, serik, aliya, olzhas, dantal };

/** Состояние персонажа для демо: первая настройка пройдена, сверка чистая не нужна — баланс считается по операциям. */
export function personaState(id: PersonaId): AppState {
  const st = BUILDERS[id]();
  return { ...st, settings: { ...st.settings, firstRunDone: true } };
}
