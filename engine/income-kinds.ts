/**
 * Виды дохода (D66, D75): вид — это поведение дохода в прогнозе, а не подпись.
 *
 * Три встроенных вида («зависит от работы», «стабильный», «нерегулярный») и свои, созданные мастером.
 * У вида есть ответы мастера (зависит ли от работы, как приходит, закончится ли), а то, как он меняется
 * в сценариях, хранится в самих сценариях по id вида (`incomeFactorsBp`, `incomeDelayMonths`) —
 * так сценарий остаётся единственным местом, где задаётся «насколько хуже или лучше».
 */
import { mulDiv, type Money } from './money';
import { money } from './explain';
import { isIsoDate } from './date';
import { slug } from './classes';
import type { IncomeScheduleItem, Settings } from './settings';
import type { ScenarioPatch } from './simulate';

export type IncomePattern = 'fixed' | 'varying' | 'irregular';

export interface IncomeKindDef {
  id: string;
  label: string;
  builtin: boolean;
  /** Пропадёт ли доход вместе с основной работой. */
  dependsOnWork: boolean;
  /** Как приходит: одинаково каждый месяц, каждый месяц с плавающей суммой, нерегулярно. */
  pattern: IncomePattern;
  /** Доход этого вида заканчивается — у каждого такого дохода нужна дата окончания. */
  ends: boolean;
}

export const BUILTIN_INCOME_KINDS: readonly IncomeKindDef[] = [
  { id: 'work', label: 'зависит от работы', builtin: true, dependsOnWork: true, pattern: 'fixed', ends: false },
  { id: 'stable', label: 'стабильный', builtin: true, dependsOnWork: false, pattern: 'fixed', ends: false },
  { id: 'irregular', label: 'нерегулярный', builtin: true, dependsOnWork: false, pattern: 'irregular', ends: false },
];

export const INCOME_PATTERN_LABELS: Record<IncomePattern, string> = {
  fixed: 'каждый месяц одинаково',
  varying: 'каждый месяц, но сумма плавает',
  irregular: 'нерегулярно',
};

export function incomeKindRegistry(custom: readonly IncomeKindDef[]): IncomeKindDef[] {
  return [...BUILTIN_INCOME_KINDS, ...custom.map((k) => ({ ...k, builtin: false }))];
}

export interface KindBehavior {
  /** Сколько остаётся от суммы, б.п. (10000 = без изменений). */
  factorBp: number;
  /** На сколько месяцев позже начинается ещё не начавшийся доход. */
  delayMonths: number;
}

/** Как сценарий меняет доход вида: запись по виду сильнее старых полей «работа»/«нерегулярный». */
export function kindBehavior(p: ScenarioPatch, kindId: string): KindBehavior {
  const legacyFactor = kindId === 'work' ? p.workIncomeFactorBp : kindId === 'irregular' ? p.irregularIncomeFactorBp : undefined;
  const legacyDelay = kindId === 'work' ? p.workDelayMonths : undefined;
  return {
    factorBp: p.incomeFactorsBp?.[kindId] ?? legacyFactor ?? 10000,
    delayMonths: p.incomeDelayMonths?.[kindId] ?? legacyDelay ?? 0,
  };
}

/** Значения мастера по ответам: зависит от работы — как у зарплаты; нерегулярный — 0 %; иначе 100 %. */
export function incomeKindDefaults(a: { dependsOnWork: boolean; pattern: IncomePattern }, adverse: ScenarioPatch): { adverseFactorBp: number; delayMonths: number } {
  if (a.dependsOnWork) {
    const w = kindBehavior(adverse, 'work');
    return { adverseFactorBp: w.factorBp, delayMonths: w.delayMonths };
  }
  if (a.pattern === 'irregular') return { adverseFactorBp: 0, delayMonths: 0 };
  return { adverseFactorBp: 10000, delayMonths: 0 };
}

export interface IncomeKindAnswers {
  label: string;
  dependsOnWork: boolean;
  pattern: IncomePattern;
  adverseFactorBp: number;
  delayMonths: number;
  ends: boolean;
}

const pct = (bp: number) => `${(bp / 100).toLocaleString('ru-RU', { maximumFractionDigits: 2 })} %`;

/** Что этот вид будет значить в расчётах — показывается в мастере до создания. */
export function incomeKindPreview(a: Omit<IncomeKindAnswers, 'label'>, example: Money): string[] {
  const lines = [
    `В прогнозе: ${money(example)} в месяц${a.pattern === 'fixed' ? '' : ' — указывай среднюю сумму'}`,
    `В неблагоприятном сценарии: ${money(mulDiv(example, a.adverseFactorBp, 10000))} (${pct(a.adverseFactorBp)})${a.delayMonths ? `; ещё не начавшийся доход — на ${a.delayMonths} мес. позже` : ''}`,
    a.dependsOnWork ? 'Зависит от работы: в благоприятном сценарии растёт вместе с зарплатой' : 'От работы не зависит',
  ];
  if (a.ends) lines.push('Закончится: у каждого такого дохода нужна дата окончания — после неё прогноз считает 0');
  return lines;
}

type Out = { ok: true; value: Settings } | { ok: false; error: string };
const norm = (x: string) => x.trim().toLowerCase().replace(/ё/g, 'е');

function checkBehavior(a: { adverseFactorBp?: number; delayMonths?: number }): string | null {
  if (a.adverseFactorBp !== undefined && (!Number.isInteger(a.adverseFactorBp) || a.adverseFactorBp < 0 || a.adverseFactorBp > 30000)) return 'Сколько остаётся в плохом сценарии — от 0 до 300 %';
  if (a.delayMonths !== undefined && (!Number.isInteger(a.delayMonths) || a.delayMonths < 0 || a.delayMonths > 24)) return 'Задержка — целое число месяцев от 0 до 24';
  return null;
}

function setScenarioEntry(s: Settings, scenarioId: string, kindId: string, factorBp: number | undefined, delay: number | undefined): Settings {
  return {
    ...s,
    scenarios: s.scenarios.map((sc) => {
      if (sc.id !== scenarioId) return sc;
      const f = { ...(sc.patch.incomeFactorsBp ?? {}) };
      const d = { ...(sc.patch.incomeDelayMonths ?? {}) };
      if (factorBp === undefined) delete f[kindId];
      else f[kindId] = factorBp;
      if (!delay) delete d[kindId];
      else d[kindId] = delay;
      // явная задержка 0 для «работы» перекрывает старое поле
      if (delay === 0 && kindId === 'work' && sc.patch.workDelayMonths) d[kindId] = 0;
      return { ...sc, patch: { ...sc.patch, incomeFactorsBp: f, incomeDelayMonths: d } };
    }),
  };
}

export function createIncomeKind(a: IncomeKindAnswers, s: Settings): Out {
  const label = a.label.trim();
  if (!label) return { ok: false, error: 'Нужно название вида' };
  const reg = incomeKindRegistry(s.incomeKinds);
  if (reg.some((k) => norm(k.label) === norm(label))) return { ok: false, error: `Вид «${label}» уже есть` };
  const bad = checkBehavior(a);
  if (bad) return { ok: false, error: bad };
  let id = `K_${slug(label)}`;
  for (let n = 2; reg.some((k) => k.id === id); n++) id = `K_${slug(label)}_${n}`;
  const def: IncomeKindDef = { id, label, builtin: false, dependsOnWork: a.dependsOnWork, pattern: a.pattern, ends: a.ends };
  let next: Settings = { ...s, incomeKinds: [...s.incomeKinds, def] };
  next = setScenarioEntry(next, 'adverse', id, a.adverseFactorBp, a.delayMonths);
  if (a.dependsOnWork) {
    const fav = next.scenarios.find((x) => x.id === 'favorable');
    if (fav) next = setScenarioEntry(next, 'favorable', id, kindBehavior(fav.patch, 'work').factorBp, 0);
  }
  return { ok: true, value: next };
}

export function updateIncomeKind(id: string, a: Partial<IncomeKindAnswers>, s: Settings): Out {
  const reg = incomeKindRegistry(s.incomeKinds);
  const k = reg.find((x) => x.id === id);
  if (!k) return { ok: false, error: 'Такого вида нет' };
  const bad = checkBehavior(a);
  if (bad) return { ok: false, error: bad };
  let next = s;
  if (k.builtin) {
    if (a.label !== undefined || a.dependsOnWork !== undefined || a.pattern !== undefined || a.ends !== undefined) return { ok: false, error: 'У встроенного вида меняется только поведение в сценарии' };
  } else {
    if (a.label !== undefined) {
      const label = a.label.trim();
      if (!label) return { ok: false, error: 'Нужно название вида' };
      if (reg.some((x) => x.id !== id && norm(x.label) === norm(label))) return { ok: false, error: `Вид «${label}» уже есть` };
    }
    next = {
      ...next,
      incomeKinds: next.incomeKinds.map((x) =>
        x.id !== id
          ? x
          : {
              ...x,
              ...(a.label !== undefined ? { label: a.label.trim() } : {}),
              ...(a.dependsOnWork !== undefined ? { dependsOnWork: a.dependsOnWork } : {}),
              ...(a.pattern !== undefined ? { pattern: a.pattern } : {}),
              ...(a.ends !== undefined ? { ends: a.ends } : {}),
            },
      ),
    };
  }
  if (a.adverseFactorBp !== undefined || a.delayMonths !== undefined) {
    const cur = kindBehavior(next.scenarios.find((x) => x.id === 'adverse')?.patch ?? {}, id);
    next = setScenarioEntry(next, 'adverse', id, a.adverseFactorBp ?? cur.factorBp, a.delayMonths ?? cur.delayMonths);
  }
  return { ok: true, value: next };
}

export function deleteIncomeKind(id: string, s: Settings): Out {
  const k = incomeKindRegistry(s.incomeKinds).find((x) => x.id === id);
  if (!k) return { ok: false, error: 'Такого вида нет' };
  if (k.builtin) return { ok: false, error: 'Встроенный вид удалить нельзя' };
  const users = [...s.incomeSchedule.filter((x) => x.kind === id).map((x) => `«${x.title}»`), ...s.plannedEvents.filter((e) => e.incomeKind === id).map((e) => `событие «${e.title}»`)];
  if (users.length) return { ok: false, error: `Этим видом помечены: ${users.join(', ')} — сначала смени им вид` };
  let next: Settings = { ...s, incomeKinds: s.incomeKinds.filter((x) => x.id !== id) };
  for (const sc of next.scenarios) next = setScenarioEntry(next, sc.id, id, undefined, undefined);
  return { ok: true, value: next };
}

/** Проверка дохода в расписании с учётом вида: вид «закончится» требует дату окончания. */
export function validateIncomeItem(item: IncomeScheduleItem, reg: readonly IncomeKindDef[]): string[] {
  const errs: string[] = [];
  const k = reg.find((x) => x.id === (item.kind ?? 'stable'));
  if (!k) errs.push('Неизвестный вид дохода');
  if (k?.ends && !item.end) errs.push(`Вид «${k.label}» заканчивается — нужна дата окончания`);
  if (item.end !== undefined && !isIsoDate(item.end)) errs.push('Некорректная дата окончания');
  return errs;
}
