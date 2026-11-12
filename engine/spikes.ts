/**
 * Всплески трат (аудит 9, D175): несколько подряд месяцев, когда по категории ушло намного больше обычного
 * (выпускные подарки, переезд, лечение). Прогноз делит такие суммы на 12 и «повторяет» их вечно, а медиана обычных трат
 * при трёх высоких месяцах из шести сдвигается. Приложение не угадывает: находит всплеск и спрашивает.
 *
 * Ответ человека (settings.spikes[id]):
 *  - never  — разовое: операции всплеска считаются классом «Больше не повторится» (в прогноз и в обычные траты не идут);
 *  - yearly — бывает раз в год: всё как раньше (сумма за год / 12), вопрос закрыт;
 *  - custom — своя сумма в год: операции всплеска выпадают, вместо них «сумма / 12» отдельной строкой.
 */
import { median, sum, tenge, ZERO, type Money } from './money';
import { fullMonthsBefore, monthKey, type IsoDate, type MonthKey } from './date';
import { monthlyFlows } from './ledger';
import { classRegistry } from './classes';
import type { ClassifiedOp, OpClass } from './classify';
import type { Overview } from './overview';
import type { AppState } from './state';
import type { SpikeAnswer } from './settings';

export const SPIKE = {
  /** Порог суммы по категории за месяц: половина обычных месячных трат человека, но не меньше `minAbsFloor` и не больше `minAbsCap` — у студента с 70 тыс. в месяц 50 тыс. подарков уже всплеск. */
  minAbsFloor: tenge(30_000) as Money,
  minAbsCap: tenge(100_000) as Money,
  minAbsShare: 0.5,
  /** … и не меньше стольких обычных месяцев (медиана по категории за 12 мес.). */
  ratio: 2.5,
  /** Истории меньше — не спрашиваем: «обычного» месяца ещё нет. */
  minMonths: 6,
} as const;

/** Тот же id, что `NEVER_CLASS_ID` в simple.ts (константа здесь — чтобы не получить цикл импортов). */
export const SPIKE_NEVER_CLASS = 'U_E_ne_povtoritsya' as OpClass;
export const SPIKE_SUFFIX = '#spike';

export interface SpikeFact {
  /** `классId@с~по` — ключ ответа. */
  id: string;
  classId: string;
  label: string;
  from: MonthKey;
  to: MonthKey;
  /** Сумма по категории за месяцы всплеска. */
  total: Money;
  /** Обычный месяц по этой категории (медиана за 12 мес.). */
  median: Money;
  months: number;
  top: { date: IsoDate; amount: Money; comment: string }[];
}

export const spikeId = (classId: string, from: MonthKey, to: MonthKey): string => `${classId}@${from}~${to}`;

export function parseSpikeId(id: string): { classId: string; from: MonthKey; to: MonthKey } | null {
  const m = /^(.+)@(\d{4}-\d{2})~(\d{4}-\d{2})$/.exec(id);
  return m ? { classId: m[1]!, from: m[2]!, to: m[3]! } : null;
}

export function spikeFacts(state: AppState, today: IsoDate, o: Overview): SpikeFact[] {
  const ops = o.classification?.ops ?? [];
  let first: IsoDate | null = null;
  for (const c of ops) if (first === null || c.op.date < first) first = c.op.date;
  const months = first === null ? [] : fullMonthsBefore(today, 12).filter((m) => m >= monthKey(first!));
  if (months.length < SPIKE.minMonths) return [];
  const flows = monthlyFlows(ops, months);
  // «обычные месячные траты» — медиана суммы всех расходных классов (кроме рассрочек и исключённых)
  const spendIds = classRegistry(state.settings.classes).filter((c) => c.group === 'expense' && c.behavior !== 'excluded' && c.behavior !== 'installment').map((c) => c.id as OpClass);
  const totalMed = median(months.map((m) => sum(spendIds.map((id) => flows[m]!.byClass[id] ?? ZERO))));
  const minAbs = Math.min(SPIKE.minAbsCap, Math.max(SPIKE.minAbsFloor, Math.round(SPIKE.minAbsShare * totalMed))) as Money;
  const out: SpikeFact[] = [];
  for (const c of classRegistry(state.settings.classes)) {
    if (c.group !== 'expense' || c.behavior === 'excluded' || c.behavior === 'installment' || c.id === SPIKE_NEVER_CLASS) continue;
    const series = months.map((m) => flows[m]!.byClass[c.id as OpClass] ?? ZERO);
    const med = median(series);
    const hot = months.map((_, i) => series[i]! >= minAbs && series[i]! >= SPIKE.ratio * Math.max(med, 1));
    for (let i = 0; i < months.length; i++) {
      if (!hot[i]) continue;
      let j = i;
      while (j + 1 < months.length && hot[j + 1]) j++;
      const from = months[i]!;
      const to = months[j]!;
      const id = spikeId(c.id, from, to);
      // одиночный месяц — обычная крупная покупка (для обычных классов это вопрос про «крупные траты», D119): спрашиваем, только если очень много
      if (j === i && series[i]! < 2 * minAbs) { i = j; continue; }
      if (state.settings.spikes?.[id] === undefined) {
        const range = ops
          .filter((x) => x.cls === c.id && x.op.kind === 'expense' && monthKey(x.op.date) >= from && monthKey(x.op.date) <= to)
          .sort((a, b) => (b.op as { amount: Money }).amount - (a.op as { amount: Money }).amount);
        out.push({
          id, classId: c.id, label: c.label, from, to,
          total: sum(series.slice(i, j + 1)), median: med, months: j - i + 1,
          top: range.slice(0, 3).map((x) => ({ date: x.op.date, amount: (x.op as { amount: Money }).amount, comment: (x.op.comment ?? '').split('\n')[0]!.slice(0, 60) })),
        });
      }
      i = j;
    }
  }
  return out.sort((a, b) => b.total - a.total);
}

/** Ответы «разовое» и «своя сумма»: операции всплеска получают класс «Больше не повторится». */
export function applySpikes(ops: readonly ClassifiedOp[], spikes: Record<string, SpikeAnswer> | undefined): ClassifiedOp[] {
  const rules = Object.entries(spikes ?? {})
    .filter(([, a]) => a.kind === 'never' || a.kind === 'custom')
    .map(([id]) => parseSpikeId(id))
    .filter((x): x is NonNullable<typeof x> => x !== null);
  if (!rules.length) return ops as ClassifiedOp[];
  return ops.map((c) => {
    if (c.op.kind !== 'expense') return c;
    const mk = monthKey(c.op.date);
    return rules.some((r) => r.classId === c.cls && mk >= r.from && mk <= r.to) ? { ...c, cls: SPIKE_NEVER_CLASS, reason: `${c.reason}; всплеск — по твоему ответу не повторяется` } : c;
  });
}
