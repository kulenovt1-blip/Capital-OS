/**
 * Общие вычисления для всех экранов одной отрисовки: «Обзор» движка, шаги настройки, доверие к цифрам.
 * Считается один раз на состояние (состояние неизменяемо — новое на каждое изменение).
 */
import { buildOverview, setupProgress, setupSteps, type AppState, type Overview, type SetupStep } from '../engine/index';
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
}

/** Одно состояние доверия к цифрам на всё приложение (D80). */
export function trust(): Trust {
  const o = ov();
  const st = getState();
  if (!o.hasData) return { level: 'none', label: 'Нет данных', reasons: [{ text: 'Загрузи бэкап MoneyManager', href: '#/import' }] };
  const bad = (o.reconcile?.accounts ?? []).filter((a) => a.status !== 'ok');
  const reasons: TrustReason[] = [];
  for (const a of bad) {
    reasons.push({ text: `Сверка: «${a.title}» ${a.status === 'no_reference' ? 'без эталона' : fmtExact(a.diff, true)} — цифрам по этому счёту нельзя верить`, href: '#/import', bad: true });
  }
  const open = steps().filter((s) => !s.optional && !s.done && !s.locked && s.id !== 'import');
  for (const s of open) reasons.push({ text: `${s.title}: ${s.status}`, href: `#/setup/${s.id}` });
  const estimate = o.capital.accounts.some((p) => p.source === 'savings_flow' && !p.excluded) && !st.settings.savingsFlows.confirmed;
  if (estimate && !open.some((s) => s.id === 'savings')) reasons.push({ text: 'В «На руках» есть оценка сбережений вне MoneyManager', href: '#/setup/savings' });
  if (bad.length) {
    const a = bad[0]!;
    return { level: 'bad', label: `Сверка: ${a.title} ${a.status === 'no_reference' ? 'без эталона' : fmtExact(a.diff, true)}${bad.length > 1 ? ` и ещё ${bad.length - 1}` : ''}`, reasons };
  }
  if (reasons.length) return { level: 'warn', label: `Приблизительно · ${nWord(reasons.length, 'вопрос', 'вопроса', 'вопросов')}`, reasons };
  return { level: 'ok', label: `Данные от ${fmtDay(st.importedAt ?? today())} ✓`, reasons: [] };
}

export { plural };
