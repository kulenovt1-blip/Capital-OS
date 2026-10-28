/**
 * Шаги первой настройки (D63): что сделано, что нет и куда идти. Чистая функция от состояния —
 * экран «Настройка» и баннер на «Обзоре» строятся из неё, порядок совпадает с пособием.
 */
import { daysBetween, fullMonthsBefore, monthKey, type IsoDate } from './date';
import { buildOverview, type NoticeAction } from './overview';
import { accountsNeedingReview } from './settings';
import type { AppState } from './state';

export interface SetupStep {
  id: 'import' | 'accounts' | 'classes' | 'income' | 'savings' | 'debts' | 'obligations' | 'goals' | 'backup';
  title: string;
  done: boolean;
  /** Необязательный шаг: не входит в «N из M». */
  optional: boolean;
  /** Зачем шаг и что будет, если его пропустить. */
  why: string;
  /** Что именно сейчас не так (для несделанного шага). */
  status: string;
  action: NoticeAction;
  /** Шаг ещё нельзя пройти: нет данных (D79). Без данных шаг не бывает «сделан». */
  locked?: boolean;
}

export function setupSteps(state: AppState, today: IsoDate): SetupStep[] {
  const o = buildOverview(state, today);
  const steps: SetupStep[] = [];
  const add = (s: SetupStep) => steps.push(s);

  add({
    id: 'import',
    title: 'Загрузить бэкап MoneyManager',
    done: o.hasData && !!o.reconcile?.ok,
    optional: false,
    why: 'Без бэкапа приложение не знает ни одного счёта и ни одной операции.',
    status: !o.hasData ? 'данных нет' : o.reconcile?.ok ? 'сверка сошлась' : 'загружен с расхождением',
    action: { route: 'import', label: !o.hasData ? 'Загрузить' : o.reconcile?.ok ? 'Открыть импорт' : 'Посмотреть' },
  });
  const review = state.imported ? accountsNeedingReview(state.settings.accounts, state.imported.accounts) : [];
  add({
    id: 'accounts',
    title: 'Ответить про счета «не учитывать в балансе»',
    done: o.hasData && review.length === 0,
    optional: false,
    why: 'Этим флагом в MoneyManager помечают и технические счета, и заначки. Заначка — твои деньги, и без ответа она не попадёт в капитал.',
    status: review.length ? `ждут ответа: ${review.map((a) => `«${a.title}»`).join(', ')}` : 'всё отвечено',
    action: { route: 'import', section: 'review', label: 'Ответить' },
  });
  const unclassified = o.classification?.unclassified ?? [];
  add({
    id: 'classes',
    title: 'Разметить категории',
    done: o.hasData && unclassified.length === 0,
    optional: false,
    why: 'Пока категория не размечена, приложение не знает, трата это, доход, долг или перевод: резерв, свободные деньги и прогноз неточны.',
    status: unclassified.length ? `не размечено категорий: ${unclassified.length}` : 'всё размечено',
    action: { route: 'classes', section: 'categories', label: 'Разметить' },
  });
  add({
    id: 'income',
    title: 'Задать расписание доходов',
    done: state.settings.incomeSchedule.length > 0,
    optional: false,
    why: 'От даты следующей зарплаты зависит, сколько отложить на платежи и жизнь до неё; без расписания горизонт условный — 30 дней.',
    status: state.settings.incomeSchedule.length ? `доходов: ${state.settings.incomeSchedule.length}` : 'не задано',
    action: { route: 'settings', section: 'income', label: 'Добавить доход' },
  });
  const hasSavings = (o.classification?.ops ?? []).some((c) => c.cls === 'T_savings_out' || c.cls === 'T_savings_in');
  if (hasSavings) {
    const sf = state.settings.savingsFlows;
    add({
      id: 'savings',
      title: 'Указать, где сейчас деньги, переведённые на сбережения',
      done: sf.mode !== 'estimate' || sf.confirmed === true,
      optional: false,
      why: 'Если эти деньги потом вернулись в MoneyManager (счётом с начальным остатком), без ответа они посчитаются дважды.',
      status: sf.mode === 'estimate' && !sf.confirmed ? 'стоит оценка по умолчанию' : 'выбрано',
      action: { route: 'settings', section: 'savings', label: 'Выбрать' },
    });
  }
  const negative = o.capital.explanation.some((s) => s.code === 'capital.payables_negative' || s.code === 'capital.receivables_negative');
  const debtsSet = state.settings.openingDebts.payable > 0 || state.settings.openingDebts.receivable > 0;
  if (negative || debtsSet) {
    add({
      id: 'debts',
      title: 'Указать долги на начало учёта',
      done: !negative || state.settings.openingDebts.acknowledged === true,
      optional: false,
      why: 'В данных есть возвраты долгов, которых в данных нет — долг был до начала учёта. Если суммы не помнишь, нажми «Не знаю — считать 0»: на расчёты это не влияет.',
      status: !negative ? 'указано' : state.settings.openingDebts.acknowledged ? 'сумма неизвестна — считается 0' : 'возвратов больше, чем долгов в данных',
      action: { route: 'settings', section: 'debts', label: 'Указать' },
    });
  }
  // рассрочки: есть ли платежи-рассрочки за последние 6 месяцев без заведённого обязательства
  const recent = new Set(fullMonthsBefore(today, 6).concat(monthKey(today)));
  const instOps = (o.classification?.ops ?? []).some((c) => (c.cls === 'E_installment_own' || c.cls === 'E_installment_family') && recent.has(monthKey(c.op.date)));
  const hasInst = state.obligations.some((x) => x.kind === 'installment');
  // находки автозаполнения (D67): шаг закрыт, когда незаведённых рассрочек в операциях нет
  const found = o.installments.suggestions.length;
  add({
    id: 'obligations',
    title: 'Завести рассрочки и долги',
    done: found === 0,
    optional: found === 0 && !instOps,
    why: 'Платежи по рассрочкам прогноз берёт из графиков обязательств; без них прогноз не знает о будущих платежах. Найденные в операциях рассрочки заполняются сами — останется указать срок или остаток.',
    status: found ? `найдено в операциях, не заведено: ${found}` : hasInst ? `обязательств: ${state.obligations.length}` : instOps ? 'рассрочки из операций заведены или отклонены' : 'рассрочек в операциях нет',
    action: { route: 'settings', section: 'obligations', label: 'Завести' },
  });
  const active = o.goals.filter((g) => g.status === 'active');
  const unconfirmed = active.filter((g) => g.targetMin <= 0);
  add({
    id: 'goals',
    title: 'Создать цели и задать суммы',
    done: active.length > 0 && unconfirmed.length === 0,
    optional: false,
    why: 'Распределение поступлений и прогноз дат работают только с целями, у которых есть сумма.',
    status: !active.length ? 'целей нет' : unconfirmed.length ? `без суммы: ${unconfirmed.map((g) => `«${g.title}»`).join(', ')}` : `целей: ${active.length}`,
    action: { route: 'goals', label: 'Открыть цели' },
  });
  const fresh = state.lastBackupAt !== null && daysBetween(state.lastBackupAt, today) <= 30;
  add({
    id: 'backup',
    title: 'Скачать бэкап приложения',
    done: fresh,
    optional: true,
    why: 'Настройки и цели хранятся только в этом браузере; очистка браузера или смена адреса — и всё пропадёт.',
    status: state.lastBackupAt ? `последний ${state.lastBackupAt}${fresh ? '' : ' — больше месяца назад'}` : 'ещё не скачивался',
    action: { route: 'settings', section: 'backup', label: 'Скачать' },
  });
  // без данных ни один шаг, кроме импорта, не бывает сделан: честный счётчик (D79)
  if (!o.hasData) for (const s of steps) if (s.id !== 'import') Object.assign(s, { done: false, status: 'после импорта', locked: true });
  return steps;
}

export function setupProgress(steps: readonly SetupStep[]): { done: number; total: number } {
  const req = steps.filter((s) => !s.optional);
  return { done: req.filter((s) => s.done).length, total: req.length };
}
