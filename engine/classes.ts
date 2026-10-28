/**
 * Классы с поведением (DECISIONS D50–D56).
 * Класс — экономическая роль операции; поведение говорит движку, как с ним считать.
 * Свои классы создаются только для доходов и расходов: финансирование и технические классы
 * держат инварианты §3.2 и остаются встроенными, рассрочки идут через обязательства.
 */
import { isMoney, type Money } from './money';
import type { IsoDate } from './date';
import { money } from './explain';
import { CLASS_LABELS, EXPENSE_CLASSES, INCOME_CLASSES, type ClassificationSettings, type OpClass } from './classify';
import { formatDateRu, isIsoDate } from './date';

export type ExpenseBehavior = 'base' | 'regular' | 'irregular' | 'temporary' | 'excluded' | 'installment';
export type IncomeBehavior = 'work' | 'other';
export type Behavior = ExpenseBehavior | IncomeBehavior;

export const BEHAVIOR_LABELS: Record<Behavior, string> = {
  base: 'базовый',
  regular: 'регулярный',
  irregular: 'нерегулярный',
  temporary: 'временный',
  excluded: 'вне прогноза',
  installment: 'рассрочка (по графику платежей)',
  work: 'работа',
  other: 'прочий доход',
};

export const BEHAVIOR_HINTS: Record<Behavior, string> = {
  base: 'без этого не прожить месяц: входит в резерв и в запас до дохода, в прогнозе — медиана за 6 мес.',
  regular: 'каждый месяц, но не обязательно: в прогнозе — медиана за 6 мес., в резерв не входит',
  irregular: 'несколько раз в год, неравномерно: в прогнозе — годовая сумма / 12 (пока истории меньше года — твоя оценка / 12)',
  temporary: 'каждый месяц до определённой даты: в прогнозе — медиана до даты, потом 0',
  excluded: 'разовые траты, которые не повторятся: в прогноз не продлеваются',
  installment: 'платежи по рассрочкам считаются по графикам обязательств, а не по истории — иначе двойной счёт',
  work: 'доход от работы: к нему применяются неблагоприятный и благоприятный сценарии',
  other: 'прочий доход',
};

export interface ClassDef {
  /** Встроенный id (E_base…) или свой: U_E_… (расход), U_I_… (доход). */
  id: OpClass;
  label: string;
  group: 'income' | 'expense';
  behavior: Behavior;
  /** Временный / базовый / доход: после этой даты в прогноз не продлевается. */
  endDate?: IsoDate;
  /** Нерегулярный: оценка на год — используется, пока истории меньше 12 полных месяцев. */
  annualEstimate?: Money;
  builtin: boolean;
}

export interface ClassOverride {
  behavior?: Behavior;
  endDate?: IsoDate;
  annualEstimate?: Money;
}

export interface ClassSettings {
  custom: ClassDef[];
  /** Изменённое поведение встроенных классов (название не меняется). */
  overrides: Record<string, ClassOverride>;
}

export const DEFAULT_CLASS_SETTINGS: ClassSettings = { custom: [], overrides: {} };

const DEFAULT_BEHAVIOR: Record<string, Behavior> = {
  E_base: 'base',
  E_installment_own: 'installment',
  E_installment_family: 'installment',
  I_work: 'work',
};

const isInstallment = (id: string) => id === 'E_installment_own' || id === 'E_installment_family';

/** Все доходные и расходные классы: встроенные (с учётом изменений) + свои. */
export function classRegistry(s: ClassSettings): ClassDef[] {
  const out: ClassDef[] = [];
  for (const id of [...INCOME_CLASSES, ...EXPENSE_CLASSES]) {
    const group = id.startsWith('I_') ? 'income' : 'expense';
    const base: ClassDef = { id, label: CLASS_LABELS[id], group, behavior: DEFAULT_BEHAVIOR[id] ?? (group === 'income' ? 'other' : 'regular'), builtin: true };
    const o = s.overrides[id];
    // поведение рассрочек не меняется: они считаются по обязательствам
    if (o && !isInstallment(id) && (!o.behavior || behaviorFits(group, o.behavior))) {
      out.push({ ...base, ...(o.behavior ? { behavior: o.behavior } : {}), ...(o.endDate ? { endDate: o.endDate } : {}), ...(o.annualEstimate !== undefined ? { annualEstimate: o.annualEstimate } : {}) });
    } else out.push(base);
  }
  out.push(...s.custom);
  return out;
}

export function behaviorFits(group: 'income' | 'expense', b: Behavior): boolean {
  return group === 'income' ? b === 'work' || b === 'other' : b !== 'work' && b !== 'other' && b !== 'installment';
}

export function validateClassDef(c: ClassDef): string[] {
  const errs: string[] = [];
  if (!c.label.trim()) errs.push('Нужно название класса');
  if (!c.builtin && !(c.group === 'expense' ? c.id.startsWith('U_E_') : c.id.startsWith('U_I_'))) errs.push('Неверный id своего класса');
  if (!behaviorFits(c.group, c.behavior) && !(c.builtin && c.behavior === 'installment')) errs.push(`Поведение «${BEHAVIOR_LABELS[c.behavior]}» не подходит для ${c.group === 'income' ? 'дохода' : 'расхода'}`);
  if (c.behavior === 'temporary' && !c.endDate) errs.push('Для временного класса нужна дата окончания');
  if (c.endDate !== undefined && !isIsoDate(c.endDate)) errs.push('Некорректная дата окончания');
  if (c.annualEstimate !== undefined && (!isMoney(c.annualEstimate) || c.annualEstimate < 0)) errs.push('Оценка на год — неотрицательная сумма');
  return errs;
}

/** Латинский идентификатор из названия (кириллица и казахские буквы транслитерируются). */
export function slug(label: string): string {
  const map: Record<string, string> = { а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'e', ж: 'zh', з: 'z', и: 'i', й: 'y', к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r', с: 's', т: 't', у: 'u', ф: 'f', х: 'h', ц: 'c', ч: 'ch', ш: 'sh', щ: 'sch', ъ: '', ы: 'y', ь: '', э: 'e', ю: 'yu', я: 'ya', ә: 'a', ғ: 'g', қ: 'k', ң: 'n', ө: 'o', ұ: 'u', ү: 'u', һ: 'h', і: 'i' };
  const s = label.trim().toLowerCase().split('').map((ch) => map[ch] ?? ch).join('').replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
  return s || 'class';
}

export interface NewClassInput {
  label: string;
  group: 'income' | 'expense';
  behavior: Behavior;
  endDate?: IsoDate;
  annualEstimate?: Money;
}

export type ClassOutcome = { ok: true; value: ClassDef } | { ok: false; error: string };

/** Создать свой класс: id из названия, уникальность названия и id. */
export function createCustomClass(i: NewClassInput, s: ClassSettings): ClassOutcome {
  const reg = classRegistry(s);
  const norm = (x: string) => x.trim().toLowerCase();
  if (reg.some((c) => norm(c.label) === norm(i.label))) return { ok: false, error: `Класс «${i.label.trim()}» уже есть` };
  const prefix = i.group === 'expense' ? 'U_E_' : 'U_I_';
  let id = `${prefix}${slug(i.label)}`;
  for (let n = 2; reg.some((c) => c.id === id); n++) id = `${prefix}${slug(i.label)}_${n}`;
  const c: ClassDef = {
    id: id as OpClass,
    label: i.label.trim(),
    group: i.group,
    behavior: i.behavior,
    ...(i.endDate ? { endDate: i.endDate } : {}),
    ...(i.annualEstimate !== undefined ? { annualEstimate: i.annualEstimate } : {}),
    builtin: false,
  };
  const errs = validateClassDef(c);
  return errs.length ? { ok: false, error: errs.join('; ') } : { ok: true, value: c };
}

/** Удалить можно только свой класс, на который не ссылается ни одно правило разметки. */
export function canDeleteClass(id: string, cls: ClassificationSettings): { ok: boolean; reason?: string } {
  if (!id.startsWith('U_')) return { ok: false, reason: 'Встроенный класс удалить нельзя' };
  const used = cls.rules.filter((r) => r.class === id || (r.refine ?? []).some((f) => f.class === id));
  if (used.length) return { ok: false, reason: `На класс размечено категорий: ${used.length}. Сначала переразметь их` };
  return { ok: true };
}

export function classLabel(id: OpClass, reg: readonly ClassDef[]): string {
  return reg.find((c) => c.id === id)?.label ?? CLASS_LABELS[id as keyof typeof CLASS_LABELS] ?? id;
}

// ───────────────────────── мастер вопросов ─────────────────────────

export interface WizardAnswers {
  group: 'income' | 'expense';
  /** Расход: эти деньги вернутся или ты их вернёшь? */
  returnsOrRepaid?: boolean;
  /** Расход: перекладываешь между своими счетами? */
  ownTransfer?: boolean;
  /** Расход: платёж по рассрочке или кредиту? */
  installment?: boolean;
  /** Расход: без этого не прожить месяц? */
  essential?: boolean;
  /** Расход: как часто? */
  frequency?: 'monthly' | 'irregular' | 'once';
  /** Расход: когда закончится (null — не закончится). */
  ends?: IsoDate | null;
  /** Нерегулярный: сколько примерно в год. */
  annualEstimate?: Money | null;
  /** Доход: может пропасть или задержаться (работа)? */
  canStop?: boolean;
  /** Доход: дата окончания. */
  incomeEnds?: IsoDate | null;
}

export type WizardOutcome =
  | { kind: 'redirect'; to: 'debt' | 'transfer' | 'obligation'; text: string }
  | { kind: 'class'; group: 'income' | 'expense'; behavior: Behavior; endDate?: IsoDate; annualEstimate?: Money; effects: string[] };

/** Ответы → поведение класса. Чистая функция; перед сохранением показывается effects. */
export function classFromAnswers(a: WizardAnswers): WizardOutcome {
  if (a.group === 'income') {
    const behavior: Behavior = a.canStop ? 'work' : 'other';
    return withEffects({ kind: 'class', group: 'income', behavior, ...(a.incomeEnds ? { endDate: a.incomeEnds } : {}), effects: [] });
  }
  if (a.returnsOrRepaid) return { kind: 'redirect', to: 'debt', text: 'Это не трата, а долг: используй встроенные классы «Выдал в долг» / «Вернул долг» — тогда возврат не посчитается доходом, а капитал не исказится' };
  if (a.ownTransfer) return { kind: 'redirect', to: 'transfer', text: 'Это перевод между своими счетами: в MoneyManager оформи его переводом — он не расход и капитал не меняет' };
  if (a.installment) return { kind: 'redirect', to: 'obligation', text: 'Платежи по рассрочке размечай классом рассрочки и заведи её в «Ещё → Долги и рассрочки» — иначе прогноз посчитает платёж дважды' };
  const ends = a.ends ?? undefined;
  let behavior: Behavior;
  if (a.essential) behavior = 'base';
  else if (a.frequency === 'once') behavior = 'excluded';
  else if (a.frequency === 'irregular') behavior = 'irregular';
  else behavior = ends ? 'temporary' : 'regular';
  return withEffects({
    kind: 'class',
    group: 'expense',
    behavior,
    ...(ends && behavior !== 'excluded' && behavior !== 'irregular' ? { endDate: ends } : {}),
    ...(behavior === 'irregular' && a.annualEstimate ? { annualEstimate: a.annualEstimate } : {}),
    effects: [],
  });
}

function withEffects(o: Extract<WizardOutcome, { kind: 'class' }>): WizardOutcome {
  const e: string[] = [];
  if (o.group === 'expense') {
    e.push(`Входит в резерв и в запас до следующего дохода: ${o.behavior === 'base' ? 'да' : 'нет'}`);
    if (o.behavior === 'base' || o.behavior === 'regular' || o.behavior === 'temporary') {
      e.push(`В прогнозе: медиана за последние полные месяцы${o.endDate ? `, до ${formatDateRu(o.endDate)}, потом 0` : ', весь горизонт'}`);
    } else if (o.behavior === 'irregular') {
      e.push(`В прогнозе: годовая сумма / 12; пока истории меньше года — ${o.annualEstimate ? `твоя оценка ${money(o.annualEstimate)} в год / 12` : 'средняя по месяцам (оценку на год лучше задать)'}`);
    } else e.push('В прогнозе: не продлевается');
  } else {
    e.push(o.behavior === 'work' ? 'Сценарии «неблагоприятный / благоприятный» меняют этот доход' : 'Сценарии этот доход не меняют');
    if (o.endDate) e.push(`Заканчивается ${formatDateRu(o.endDate)}`);
    e.push('Прогноз доходов строится по расписанию доходов в настройках: класс дохода сейчас — метка для отчётов');
  }
  return { ...o, effects: e };
}
