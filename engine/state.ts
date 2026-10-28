/**
 * Состояние приложения: всё, что хранится локально (IndexedDB) и уходит в JSON-бэкап.
 * Движок не знает про IndexedDB — здесь только модель, сериализация и проверка.
 */
import { isMoney } from './money';
import { isIsoDate, type IsoDate } from './date';
import type { Explanation } from './explain';
import type { ImportedData } from './types';
import type { Obligation } from './obligations';
import type { Goal, GoalFunding } from './goals';
import type { StrategyId } from './ladder';

/**
 * Запись решения (§8). Неизменяема: исправление — новой записью.
 * На этапе 3 пишутся только решения о распределении; журнал, снимки и сверка — этап 4.
 */
export interface Decision {
  id: string;
  date: IsoDate;
  type: 'allocation' | 'goal_change' | 'what_if_accepted';
  input: Record<string, unknown>;
  chosenStrategy: StrategyId[] | null;
  /** Кратко: альтернативы и их «цена». */
  alternatives: string[];
  explanation: string[];
  userNote: string;
}
import { DEFAULT_SETTINGS, normalizeIncomeKind, type Adjustment, type ManualAccount, type Settings } from './settings';

export const STATE_VERSION = 1;
export const APP_ID = 'capital-os';

export interface AppState {
  /** Последний импорт из MoneyManager (целиком; повторный импорт заменяет). */
  imported: ImportedData | null;
  importedAt: IsoDate | null;
  settings: Settings;
  manualAccounts: ManualAccount[];
  adjustments: Adjustment[];
  obligations: Obligation[];
  /** Ручная привязка операции к обязательству: opId → obligationId. */
  manualMatches: Record<string, string>;
  /** Цели (этап 2). */
  goals: Goal[];
  /** Журнал назначений денег целям (D38). */
  fundings: GoalFunding[];
  decisions: Decision[];
  /** Когда последний раз скачан JSON-бэкап приложения (шаг настройки «Бэкап»). */
  lastBackupAt: IsoDate | null;
}

export function emptyState(): AppState {
  return {
    imported: null,
    importedAt: null,
    settings: structuredClone(DEFAULT_SETTINGS),
    manualAccounts: [],
    adjustments: [],
    obligations: [],
    manualMatches: {},
    goals: [],
    fundings: [],
    decisions: [],
    lastBackupAt: null,
  };
}

/** Детерминированный JSON: ключи объектов отсортированы. Дата экспорта — параметр. */
export function serializeState(s: AppState, exportedAt: IsoDate): string {
  return stableStringify({ app: APP_ID, version: STATE_VERSION, exportedAt, state: s });
}

export function stableStringify(v: unknown): string {
  return JSON.stringify(sortKeys(v), null, 1);
}

function sortKeys(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(sortKeys);
  if (v && typeof v === 'object') {
    const o = v as Record<string, unknown>;
    return Object.fromEntries(
      Object.keys(o)
        .filter((k) => o[k] !== undefined)
        .sort()
        .map((k) => [k, sortKeys(o[k])]),
    );
  }
  return v;
}

export type ParseResult = { ok: true; value: AppState; explanation: Explanation } | { ok: false; error: string; explanation: Explanation };

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

/** Разбор JSON-бэкапа. Недостающие поля дополняются дефолтами; суммы проверяются на целые тиыны. */
export function parseState(json: string): ParseResult {
  const fail = (error: string): ParseResult => ({ ok: false, error, explanation: [{ code: 'state.invalid', text: error, level: 'error' }] });
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    return fail('Файл не является JSON');
  }
  if (!isObj(raw) || raw.app !== APP_ID) return fail('Это не бэкап Capital OS');
  if (typeof raw.version !== 'number' || raw.version > STATE_VERSION) {
    return fail(`Бэкап создан более новой версии приложения (${String(raw.version)}); эта версия понимает до ${STATE_VERSION}`);
  }
  const s = isObj(raw.state) ? raw.state : {};
  const base = emptyState();
  const state: AppState = {
    imported: (s.imported as ImportedData | null | undefined) ?? null,
    importedAt: typeof s.importedAt === 'string' ? s.importedAt : null,
    settings: { ...base.settings, ...(isObj(s.settings) ? (s.settings as Partial<Settings>) : {}) },
    manualAccounts: Array.isArray(s.manualAccounts) ? (s.manualAccounts as ManualAccount[]) : [],
    adjustments: Array.isArray(s.adjustments) ? (s.adjustments as Adjustment[]) : [],
    obligations: Array.isArray(s.obligations) ? (s.obligations as Obligation[]) : [],
    manualMatches: isObj(s.manualMatches) ? (s.manualMatches as Record<string, string>) : {},
    goals: Array.isArray(s.goals) ? (s.goals as Goal[]) : [],
    fundings: Array.isArray(s.fundings) ? (s.fundings as GoalFunding[]) : [],
    decisions: Array.isArray(s.decisions) ? (s.decisions as Decision[]) : [],
    lastBackupAt: typeof s.lastBackupAt === 'string' ? s.lastBackupAt : null,
  };
  migrateState(state);
  const errs = validateState(state);
  if (errs.length) return fail(`Бэкап повреждён: ${errs.slice(0, 5).join('; ')}${errs.length > 5 ? ` и ещё ${errs.length - 5}` : ''}`);
  return { ok: true, value: state, explanation: [{ code: 'state.loaded', text: `Бэкап версии ${raw.version} загружен` }] };
}

/**
 * Перевод старых бэкапов на текущие понятия (по месту, детерминированно):
 * виды доходов «стипендия»/«другое» → «стабильный»; сохранённый неблагоприятный сценарий без
 * коэффициента нерегулярного дохода получает значение по умолчанию 0 (D66).
 */
export function migrateState(s: AppState): void {
  s.settings.incomeKinds = Array.isArray(s.settings.incomeKinds) ? s.settings.incomeKinds : [];
  const custom = s.settings.incomeKinds.map((k) => k.id);
  s.settings.incomeSchedule = s.settings.incomeSchedule.map((x) => ({ ...x, kind: normalizeIncomeKind(x.kind, custom) }));
  s.settings.scenarios = s.settings.scenarios.map((sc) =>
    sc.id === 'adverse' && sc.patch.irregularIncomeFactorBp === undefined ? { ...sc, patch: { ...sc.patch, irregularIncomeFactorBp: 0 } } : sc,
  );
}

/** Проверка денег и дат во всех сущностях. Пустой список — всё в порядке. */
export function validateState(s: AppState): string[] {
  const errs: string[] = [];
  const m = (v: unknown, where: string) => {
    if (!isMoney(v)) errs.push(`${where}: сумма «${String(v)}» не целое число тиынов`);
  };
  const d = (v: unknown, where: string) => {
    if (!isIsoDate(v)) errs.push(`${where}: дата «${String(v)}» некорректна`);
  };
  s.manualAccounts.forEach((a, i) => {
    m(a.balance, `ручной счёт ${i + 1}`);
    d(a.balanceDate, `ручной счёт ${i + 1}`);
  });
  s.adjustments.forEach((a, i) => {
    m(a.amount, `корректировка ${i + 1}`);
    d(a.date, `корректировка ${i + 1}`);
  });
  s.obligations.forEach((o, i) => {
    m(o.remaining, `обязательство «${o.title ?? i + 1}»`);
    (o.schedule ?? []).forEach((e, j) => {
      m(e.amount, `обязательство «${o.title}», платёж ${j + 1}`);
      d(e.date, `обязательство «${o.title}», платёж ${j + 1}`);
    });
  });
  s.settings.incomeSchedule.forEach((x, i) => m(x.amount, `доход ${i + 1}`));
  if (s.settings.openingDebts) {
    m(s.settings.openingDebts.receivable, 'долг мне на начало учёта');
    m(s.settings.openingDebts.payable, 'мой долг на начало учёта');
  }
  for (const c of s.settings.classes?.custom ?? []) {
    if (c.annualEstimate !== undefined) m(c.annualEstimate, `класс «${c.label}», оценка на год`);
    if (c.endDate !== undefined) d(c.endDate, `класс «${c.label}», дата окончания`);
  }
  for (const [k, o] of Object.entries(s.settings.classes?.overrides ?? {})) if (o.annualEstimate !== undefined) m(o.annualEstimate, `класс ${k}, оценка на год`);
  s.goals.forEach((g) => {
    m(g.targetMin, `цель «${g.title}»`);
    if (g.targetComfort !== undefined) m(g.targetComfort, `цель «${g.title}», комфортная сумма`);
    if (g.minMonthlyFunding !== undefined) m(g.minMonthlyFunding, `цель «${g.title}», минимальный взнос`);
  });
  s.fundings.forEach((f, i) => {
    m(f.amount, `назначение ${i + 1}`);
    d(f.date, `назначение ${i + 1}`);
  });
  if (s.imported) {
    for (const op of s.imported.operations ?? []) {
      if (op.kind === 'transfer') {
        m(op.fromAmount, `перевод ${op.id}`);
        m(op.toAmount, `перевод ${op.id}`);
      } else m(op.amount, `операция ${op.id}`);
      if (errs.length > 20) break;
    }
    for (const [k, v] of Object.entries(s.imported.reportedBalances ?? {})) m(v, `баланс счёта ${k}`);
  }
  return errs;
}
