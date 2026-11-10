/**
 * Общие вычисления для всех экранов одной отрисовки: «Обзор» движка, шаги настройки, доверие к цифрам.
 * Считается один раз на состояние (состояние неизменяемо — новое на каждое изменение).
 */
import { baseForecast, buildOverview, personStage, positionViewOf, type PositionView, type PersonStage, unconfirmedCategories, goalVerdicts, monthsWithoutIncome, setupProgress, setupSteps, type AppState, type GoalVerdict, type Overview, type SetupStep, type SimResult } from '../engine/index';
import { getState, today } from './store';
import { fmtExact, fmtDay, nWord, plural } from './ui';

let memoState: AppState | null = null;
let memoToday = '';
let memo: { o: Overview; steps: SetupStep[] } | null = null;

function compute(): { o: Overview; steps: SetupStep[] } {
  const st = getState();
  const t = today();
  if (memo && memoState === st && memoToday === t) return memo;
  memoState = st;
  memoToday = t;
  memo = { o: buildOverview(st, t), steps: setupSteps(st, t) };
  return memo;
}

export const ov = (): Overview => compute().o;

// прогноз «как сейчас», вердикты целей и запас прочности — тяжелее Обзора, считаются по запросу (D96)
let fcState: AppState | null = null;
let fcKey = '';
let fc: { sim?: SimResult; verdicts?: Map<string, GoalVerdict>; noIncome?: ReturnType<typeof monthsWithoutIncome> | undefined; noIncomeDone?: boolean; stage?: PersonStage | null; stageDone?: boolean } = {};
function fcMemo() {
  const st = getState();
  const k = today();
  if (fcState !== st || fcKey !== k) {
    fcState = st;
    fcKey = k;
    fc = {};
  }
  return fc;
}
export function forecastNow(): SimResult {
  const m = fcMemo();
  return (m.sim ??= baseForecast(getState(), today()));
}
export function verdicts(): Map<string, GoalVerdict> {
  const m = fcMemo();
  if (!getState().imported) return new Map();
  return (m.verdicts ??= goalVerdicts(getState(), today(), forecastNow()));
}
/** «Твой этап» (D115) — считается по запросу и один раз на состояние. */
export function stageNow(): PersonStage | null {
  const m = fcMemo();
  if (!m.stageDone) {
    m.stage = personStage(getState(), today());
    m.stageDone = true;
  }
  return m.stage ?? null;
}
export function monthsWithoutIncomeNow(): ReturnType<typeof monthsWithoutIncome> {
  const m = fcMemo();
  if (!m.noIncomeDone) {
    m.noIncome = monthsWithoutIncome(getState(), today());
    m.noIncomeDone = true;
  }
  return m.noIncome ?? null;
}
export const steps = (): SetupStep[] => compute().steps;
export const progress = () => setupProgress(steps());

/** Счета, у которых не сошлась сверка: красная точка во всех списках (D80). */
export function badAccounts(): Set<string> {
  const r = ov().reconcile;
  return new Set((r?.accounts ?? []).filter((a) => a.status !== 'ok').map((a) => a.accountId));
}

export interface TrustReason {
  text: string;
  href: string;
  bad?: boolean;
}

export interface Trust {
  level: 'none' | 'ok' | 'warn' | 'bad';
  label: string;
  reasons: TrustReason[];
  /** Что основано на оценке, а не на данных банка, — не делает точку жёлтой, но видно в подробностях (D104). */
  notes: TrustReason[];
}

/** Одно состояние доверия к цифрам на всё приложение (D80). */
export function trust(): Trust {
  const o = ov();
  const st = getState();
  if (!o.hasData) return { level: 'none', label: 'Нет данных', reasons: [{ text: 'Загрузи бэкап MoneyManager', href: '#/import' }], notes: [] };
  const bad = (o.reconcile?.accounts ?? []).filter((a) => a.status !== 'ok');
  const reasons: TrustReason[] = [];
  for (const a of bad) {
    reasons.push({ text: `Сверка: «${a.title}» ${a.status === 'no_reference' ? 'без эталона' : fmtExact(a.diff, true)} — цифрам по этому счёту нельзя верить`, href: '#/import', bad: true });
  }
  const open = steps().filter((s) => !s.optional && !s.done && !s.locked && s.id !== 'import');
  for (const s of open) reasons.push({ text: `${s.title}: ${s.status}`, href: `#/setup/${s.id}` });
  const estimate = o.capital.accounts.some((p) => p.source === 'savings_flow' && !p.excluded) && !st.settings.savingsFlows.confirmed;
  if (estimate && !open.some((s) => s.id === 'savings')) reasons.push({ text: 'В «Всего на счетах» есть оценка сбережений вне MoneyManager', href: '#/setup/savings' });
  // предположения приложения — тоже повод проверить, даже если сверка сошлась (D104)
  const cats = unconfirmedCategories(st.settings.classification);
  if (cats.unknown.length) reasons.push({ text: `${nWord(cats.unknown.length, 'категория', 'категории', 'категорий')} трат приложение не узнало — в прогнозе по среднему`, href: '#/baskets' });
  if (cats.guessed.length) reasons.push({ text: `${nWord(cats.guessed.length, 'категория', 'категории', 'категорий')} разложено по названию — проверь`, href: '#/baskets' });
  for (const id of o.spend.guessedSavings) reasons.push({ text: `«${o.capital.accounts.find((p) => p.accountId === id)?.title ?? id}» — копилка по названию, проверь`, href: sheetHrefFor('accounts', 'account', id) });
  const notes: TrustReason[] = [];
  const est = o.capital.accounts.find((p) => p.source === 'savings_flow' && !p.excluded && p.balance !== 0);
  if (est && st.settings.savingsFlows.confirmed) notes.push({ text: `«${est.title}» — ${fmtExact(est.balance)}: это оценка по переводам, а не баланс банка`, href: '#/accounts/savings' });
  if (o.baseline.months.length < 3 && o.baseline.months.length < st.settings.baselineMonths) notes.push({ text: `Истории трат ${nWord(o.baseline.months.length, 'полный месяц', 'полных месяца', 'полных месяцев')} — «обычно уходит» и прогноз приблизительные`, href: '#/baskets' });
  if (bad.length) {
    const a = bad[0]!;
    return { level: 'bad', label: `Сверка: ${a.title} ${a.status === 'no_reference' ? 'без эталона' : fmtExact(a.diff, true)}${bad.length > 1 ? ` и ещё ${bad.length - 1}` : ''}`, reasons, notes };
  }
  if (reasons.length) return { level: 'warn', label: `Проверь · ${nWord(reasons.length, 'вопрос', 'вопроса', 'вопросов')}`, reasons, notes };
  return { level: 'ok', label: `Данные от ${fmtDay(st.importedAt ?? today())} ✓`, reasons: [], notes };
}

/** Адрес подэкрана на другом экране (ctx не зависит от main.ts). */
function sheetHrefFor(screen: string, sheet: string, arg: string): string {
  return `#/${screen}~${sheet}/${arg}`;
}

export { plural };

// «Положение» v4 (T11): модель экрана считается один раз на состояние и дату, как «Обзор»
let posState: AppState | null = null;
let posToday = '';
let posView: PositionView | null = null;
export function positionNow(): PositionView {
  const st = getState();
  const t = today();
  if (posView && posState === st && posToday === t) return posView;
  posState = st;
  posToday = t;
  posView = positionViewOf(st, t);
  return posView;
}
