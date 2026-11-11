/**
 * «Точность расчётов»: насколько приложению можно верить с тем, что у него есть (аудит UX, бэкап мамы: пустая история молча давала нули).
 * Это не математика модели, а честная оценка полноты данных по пяти фактам; формулы и цифры приложения она не меняет.
 */
import type { AppState } from './state';
import type { Overview } from './overview';
import type { IsoDate } from './date';
import { daysBetween, fullMonthsBefore } from './date';

export type AccuracyLevel = 'none' | 'low' | 'mid' | 'good';

export interface AccuracyFact {
  ok: boolean;
  text: string;
  /** Что сделать, чтобы стало лучше (нет — если не зависит от человека). */
  fix?: { text: string; href: string };
}

export interface Accuracy {
  level: AccuracyLevel;
  label: string;
  /** Одна фраза: чего это стоит для цифр. */
  meaning: string;
  facts: AccuracyFact[];
  /** Сколько из 6 прошлых полных месяцев содержат хотя бы 5 трат. */
  filledMonths: number;
}

const MIN_OPS = 5;

export function dataAccuracy(state: AppState, today: IsoDate, o: Overview): Accuracy {
  if (!o.hasData || !state.imported) {
    return { level: 'none', label: 'Нет данных', meaning: 'Без бэкапа MoneyManager приложение ничего не знает.', facts: [], filledMonths: 0 };
  }
  const months = fullMonthsBefore(today, 6);
  const per = new Map<string, number>();
  let last: string | null = null;
  for (const op of state.imported.operations) {
    if (op.kind !== 'expense') continue;
    const m = op.date.slice(0, 7);
    per.set(m, (per.get(m) ?? 0) + 1);
    if (last === null || op.date > last) last = op.date;
  }
  const filled = months.filter((m) => (per.get(m) ?? 0) >= MIN_OPS).length;
  const age = last ? daysBetween(last, today) : null;
  const recent = age !== null && age <= 14;
  const reconcileOk = !!o.reconcile?.ok;
  const hasIncome = state.settings.incomeSchedule.length > 0;
  const historyOk = filled >= 5;
  const facts: AccuracyFact[] = [
    {
      ok: historyOk,
      text: `Истории трат: ${filled} из 6 прошлых месяцев`,
      ...(historyOk ? {} : { fix: { text: filled < 3 ? `Нужно вести записи ещё ${3 - filled} мес. — до этого «обычно уходит», запас и ступень приблизительны` : 'Чем больше полных месяцев с записями, тем надёжнее запас', href: '#/data' } }),
    },
    {
      ok: recent,
      text: age === null ? 'Свежих трат нет' : age === 0 ? 'Последняя трата — сегодня' : `Последняя трата — ${age} дн. назад`,
      ...(recent ? {} : { fix: { text: 'Выгрузи свежий бэкап MoneyManager', href: '#/import' } }),
    },
    { ok: reconcileOk, text: reconcileOk ? 'Остатки на счетах сошлись с MoneyManager' : 'Остатки на счетах не сошлись', ...(reconcileOk ? {} : { fix: { text: 'Открой сверку', href: '#/import' } }) },
    { ok: hasIncome, text: hasIncome ? 'Расписание доходов задано' : 'Доходы не заданы — прогноз идёт «вслепую»', ...(hasIncome ? {} : { fix: { text: 'Добавь доход', href: '#/incomes' } }) },
    { ok: o.baseline.median > 0, text: o.baseline.median > 0 ? 'Обычные траты посчитаны' : 'Обычные траты посчитаны как 0 — нет данных за 6 месяцев' },
  ];
  const level: AccuracyLevel = filled < 3 || !reconcileOk || !hasIncome ? 'low' : historyOk && recent ? 'good' : 'mid';
  const label = level === 'low' ? 'Низкая' : level === 'mid' ? 'Средняя' : 'Хорошая';
  const meaning =
    level === 'low'
      ? 'Цифры приблизительные: запас, ступень и прогноз могут сильно отличаться от реальности.'
      : level === 'mid'
        ? 'Цифрам можно доверять в целом, но запас и динамика ещё могут уточниться.'
        : 'Данных хватает: приложение опирается на полную историю.';
  return { level, label, meaning, facts, filledMonths: filled };
}
