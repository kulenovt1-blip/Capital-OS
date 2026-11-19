/** Демо-персонажи «На примере»: описания для карточек (Русский язык; сами данные — public/personas/<id>.json, их собирает scripts/make-personas.ts). */
export type PersonaId = 'berik' | 'serik' | 'aliya' | 'olzhas' | 'dantal';

export interface PersonaMeta {
  id: PersonaId;
  name: string;
  /** Одна строка о человеке для карточки выбора. */
  line: string;
  /** Целевая ступень (проверяется тестом tests/unit/persona-levels.test.ts). */
  level: 1 | 2 | 3 | 4 | 5;
}

export const PERSONAS: readonly PersonaMeta[] = [
  { id: 'berik', name: 'Берик', line: '29 лет. Потерял стабильную работу, живёт на подработки и неполную ставку; берёт новые займы, чтобы дотянуть до конца месяца.', level: 1 },
  { id: 'serik', name: 'Серик', line: '32 года. Стабильная зарплата, платит вовремя, закрывает рассрочку на телефон; запаса почти нет.', level: 2 },
  { id: 'aliya', name: 'Алия', line: '31 год. Хорошая зарплата и квартира в ипотеку; откладывает, подушка есть.', level: 3 },
  { id: 'olzhas', name: 'Олжас', line: '38 лет. Хорошая работа, своя квартира и машина, раз в год — отпуск; один источник дохода и крупный платёж.', level: 4 },
  { id: 'dantal', name: 'Дантал', line: '45 лет. Живёт на проценты по вкладам: тратит меньше половины того, что они приносят.', level: 5 },
];

export const personaById = (id: string | null | undefined): PersonaMeta | undefined => PERSONAS.find((p) => p.id === id);

/** Дата, на которую собраны персонажи: в режиме примера «сегодня» всегда она. */
export const PERSONA_DATE = '2026-11-04';

export const LEVEL_NAMES: Record<PersonaMeta['level'], string> = { 1: 'Не хватает на жизнь', 2: 'От зарплаты до зарплаты', 3: 'Есть подушка', 4: 'Защищён от ударов', 5: 'Могу не смотреть на цены' };
