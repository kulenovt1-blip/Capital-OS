/**
 * Экран «Цели» как чистая функция: дерево с прогрессом, счета для назначения, превышения, свободные деньги.
 */
import { add, sub, ZERO, type Money } from './money';
import type { IsoDate } from './date';
import type { Explanation } from './explain';
import { assignedByAccount, flattenTree, type Goal, type GoalFunding, type GoalNode, type OverAssignment } from './goals';
import type { Baseline } from './ledger';
import { buildOverview } from './overview';
import { accountsNeedingReview } from './settings';
import type { AppState } from './state';

export interface GoalAccountView {
  accountId: string;
  title: string;
  balance: Money;
  assigned: Money;
  /** Сколько ещё можно назначить на этом счёте. */
  free: Money;
  liquidNow: boolean;
}

export type AccountStatus = 'available' | 'empty' | 'fully_assigned' | 'bound' | 'excluded' | 'needs_review';

/** Счёт в выборе «откуда назначить»: недоступные показываются с причиной, а не прячутся. */
export interface AccountAvailability {
  accountId: string;
  title: string;
  balance: Money;
  free: Money;
  status: AccountStatus;
  /** Почему нельзя назначить (пусто для available). */
  reason: string;
}

export interface GoalsView {
  tree: GoalNode[];
  flat: GoalNode[];
  goals: Goal[];
  accounts: GoalAccountView[];
  balances: Record<string, Money>;
  /** Назначения с учётом привязок счетов — для проверок назначения. */
  fundings: GoalFunding[];
  /** Все неудалённые счета со статусом доступности. */
  allAccounts: AccountAvailability[];
  overAssigned: OverAssignment[];
  baseline: Baseline;
  freeMoney: Money;
  totalAssigned: Money;
  explanation: Explanation;
}

export function buildGoalsView(state: AppState, today: IsoDate): GoalsView {
  const o = buildOverview(state, today);
  const byAcc = assignedByAccount(o.fundings);
  const accounts: GoalAccountView[] = o.capital.accounts
    .filter((p) => !p.excluded)
    .map((p) => {
      const assigned = byAcc.get(p.accountId) ?? ZERO;
      return { accountId: p.accountId, title: p.title, balance: p.balance, assigned, free: sub(p.balance, assigned), liquidNow: p.availableFrom <= today };
    });
  // все счета с причиной недоступности — в выборе «откуда назначить» ничего не пропадает молча
  const settingsById = new Map(state.settings.accounts.map((s) => [s.accountId, s]));
  const needReview = new Set(accountsNeedingReview(state.settings.accounts, state.imported?.accounts ?? []).map((a) => a.id));
  const goalTitle = (id: string) => o.goals.find((g) => g.id === id)?.title ?? id;
  const allAccounts: AccountAvailability[] = o.capital.accounts.map((p) => {
    const assigned = byAcc.get(p.accountId) ?? ZERO;
    const free = sub(p.balance, assigned);
    const bound = settingsById.get(p.accountId)?.boundGoalId;
    let status: AccountStatus;
    let reason = '';
    if (needReview.has(p.accountId)) {
      status = 'needs_review';
      reason = 'в MoneyManager помечен «не учитывать в балансе» — ответь на экране «Импорт», что это за счёт';
    } else if (p.excluded) {
      status = 'excluded';
      reason = 'исключён из анализа («Настройки → Счета»)';
    } else if (bound && o.goals.some((g) => g.id === bound && g.status !== 'cancelled' && g.status !== 'done')) {
      status = 'bound';
      reason = `весь остаток уже за целью «${goalTitle(bound)}»`;
    } else if (p.balance <= 0) {
      status = 'empty';
      reason = 'на счёте нет денег';
    } else if (free <= 0) {
      status = 'fully_assigned';
      reason = 'все деньги на счёте уже назначены целям';
    } else status = 'available';
    return { accountId: p.accountId, title: p.title, balance: p.balance, free, status, reason };
  });
  let totalAssigned = ZERO;
  for (const v of byAcc.values()) totalAssigned = add(totalAssigned, v);
  return {
    tree: o.goalTree,
    flat: flattenTree(o.goalTree),
    goals: o.goals,
    accounts,
    balances: o.balances,
    fundings: o.fundings,
    allAccounts,
    overAssigned: o.overAssigned,
    baseline: o.baseline,
    freeMoney: o.freeMoney,
    totalAssigned,
    explanation: o.explanation.filter((s) => s.code.startsWith('goal') || s.code.startsWith('baseline') || s.code.startsWith('overview.free')),
  };
}
