/**
 * Ступень «по запасу» в будущем (аудит UX): помесячный прогноз уже знает деньги, расходы, платежи и доходы на каждый месяц,
 * а условия ступеней 3 и 4 — это запас в 3 и 6 месяцев необходимых расходов и отсутствие дефицита. Эти два факта считаются на любой месяц.
 * Полная оценка (три направления) строится из истории и в будущем не определена, поэтому это верхняя граница, а не прогноз ступени.
 * Ничего не придумывается: доходы и расходы после перемен, которых человек не ввёл, приложению неизвестны (см. `unknownNote`).
 */
import { LEVEL_NAMES, type Money, type MonthKey, type SimResult } from '../engine/index';
import { ov, reserveCtx } from './ctx';
import { getState } from './store';
import { monthWord } from './ui';

export type CapLevel = 1 | 2 | 3 | 4;

export interface FutureTrack {
  months: MonthKey[];
  /** Деньги сразу за вычетом долгов людям, на конец месяца. */
  money: Money[];
  /** Необходимый месяц с платежами (сегодняшний; рост цен и перемены в нём не учтены). */
  need: Money[];
  /** Запас в месяцах. */
  reserve: number[];
  cap: CapLevel[];
  /** Ступень «по запасу» сегодня. */
  capNow: CapLevel;
}

/** Верхняя граница ступени по фактам: запас < 3 мес. — не выше 2 (при дефиците — 1); 3–6 — не выше 3; от 6 — не выше 4. */
export function capOf(reserveMonths: number, deficit: boolean): CapLevel {
  if (reserveMonths < 3) return deficit ? 1 : 2;
  return reserveMonths < 6 ? 3 : 4;
}

/** Помесячный путь запаса по прогнозу на `k` месяцев вперёд; null — считать не из чего. */
export function futureTrack(sim: SimResult, k: number): FutureTrack | null {
  const stg = reserveCtx();
  if (!stg || sim.months.length < 2) return null;
  const payables = ov().capital.liabilities.payablesFromOps;
  const spend = (i: number): number => (sim.months[i]!.expenses as number) + (sim.months[i]!.obligations as number);
  const n = Math.min(k, sim.months.length - 1);
  const months: MonthKey[] = [];
  const money: Money[] = [];
  const need: Money[] = [];
  const reserve: number[] = [];
  const cap: CapLevel[] = [];
  for (let i = 1; i <= n; i++) {
    const m = sim.months[i]!;
    // нужное в месяц — сегодняшнее: прогнозные траты месяца включают разовые и сезонные, они «нужное» не меняют
    const nd = Math.max(1, stg.needMonthly as number);
    const mo = Math.max(0, (m.liquidEnd as number) - (payables as number));
    const r = Math.floor((mo * 10) / nd) / 10;
    months.push(m.month);
    money.push(mo as Money);
    need.push(nd as Money);
    reserve.push(r);
    cap.push(capOf(r, (m.income as number) < spend(i)));
  }
  return { months, money, need, reserve, cap, capNow: capOf(stg.coverMonths, stg.surplusMonthly < 0) };
}

const THRESHOLD: Record<number, number> = { 2: 3, 3: 6 };

/** Что показать человеку: главный вывод одной фразой и подробность. */
export function futureSummary(t: FutureTrack): { headline: string; detail: string; changed: boolean } {
  const last = t.cap.length - 1;
  const drop = t.cap.findIndex((c) => c < t.capNow);
  if (drop >= 0) {
    const c = t.cap[drop]!;
    const need = THRESHOLD[c] ?? 3;
    return {
      headline: `С ${monthWord(t.months[drop]!)} по запасу не выше ступени ${c} («${LEVEL_NAMES[c]}»)`,
      detail: `запас станет ≈ ${t.reserve[drop]!.toFixed(1).replace('.', ',')} мес. — ниже ${need} мес. необходимых расходов`.replace(/мес\. — ниже 3/, 'мес. — ниже 3'),
      changed: true,
    };
  }
  const r = t.reserve[last]!;
  return {
    headline: `Через ${t.months.length} мес. по запасу ступень не ниже, чем сейчас`,
    detail: `запас ≈ ${r.toFixed(1).replace('.', ',')} мес. необходимых расходов`,
    changed: false,
  };
}

export const unknownNote = (plans: number): string =>
  plans > 0
    ? `Учтено планов: ${plans}. Не учтено: перемены, которых ты не вводил.`
    : 'Планов нет: «если всё как сейчас». Переезд или смену работы добавь в «Планирую…» ниже.';

export const plansCount = (): number => (getState().settings.plannedEvents ?? []).length;

/** Строка для предпросмотра: запас и ступень по запасу через `k` мес. — без события и с ним. null — не из чего считать или ничего не меняется. */
export function levelShiftLine(base: SimResult, withEv: SimResult, k = 12): string | null {
  const a = futureTrack(base, k);
  const b = futureTrack(withEv, k);
  if (!a || !b) return null;
  const i = Math.min(a.reserve.length, b.reserve.length) - 1;
  if (i < 0) return null;
  const f = (r: number): string => r.toFixed(1).replace('.', ',');
  const ca = a.cap[i]!;
  const cb = b.cap[i]!;
  const tail = ca === cb ? `ступень по запасу та же — не выше ${ca}` : `ступень по запасу не выше: ${ca} → ${cb}`;
  return `Запас через ${a.months.length > i ? i + 1 : k} мес.: ${f(a.reserve[i]!)} → ${f(b.reserve[i]!)} мес. · ${tail}`;
}
