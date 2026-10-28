/**
 * Классификация операций: каждая операция получает ровно один класс.
 * Правила — редактируемая таблица «категория → класс» с уточнениями по тегам и комментарию.
 */
import { add, ZERO, type Money } from './money';
import type { Category, ImportedData, Operation } from './types';

export const INCOME_CLASSES = ['I_work', 'I_benefit', 'I_stipend', 'I_gift', 'I_interest', 'I_cashback', 'I_other'] as const;
export const EXPENSE_CLASSES = ['E_base', 'E_fun', 'E_family', 'E_health', 'E_edu', 'E_installment_own', 'E_installment_family', 'E_other'] as const;
export const FINANCING_CLASSES = ['F_lent', 'F_lent_back', 'F_borrowed', 'F_borrowed_back'] as const;
export const TECH_CLASSES = ['T_transfer', 'T_savings_out', 'T_savings_in', 'T_correction'] as const;

export type IncomeClass = (typeof INCOME_CLASSES)[number];
export type ExpenseClass = (typeof EXPENSE_CLASSES)[number];
export type BuiltinClass = IncomeClass | ExpenseClass | (typeof FINANCING_CLASSES)[number] | (typeof TECH_CLASSES)[number] | 'UNCLASSIFIED';
/** Свои классы пользователя: U_E_… — расход, U_I_… — доход (engine/classes.ts). */
export type CustomClassId = `U_E_${string}` | `U_I_${string}`;
export type OpClass = BuiltinClass | CustomClassId;

export const ALL_CLASSES: readonly BuiltinClass[] = [...INCOME_CLASSES, ...EXPENSE_CLASSES, ...FINANCING_CLASSES, ...TECH_CLASSES, 'UNCLASSIFIED'];

export const CLASS_LABELS: Record<BuiltinClass, string> = {
  I_work: 'Доход: работа',
  I_benefit: 'Доход: пособие',
  I_stipend: 'Доход: стипендия',
  I_gift: 'Доход: подарок',
  I_interest: 'Доход: проценты',
  I_cashback: 'Доход: кэшбэк, бонусы',
  I_other: 'Доход: прочее',
  E_base: 'Расход: базовый',
  E_fun: 'Расход: развлечения',
  E_family: 'Расход: семья',
  E_health: 'Расход: здоровье',
  E_edu: 'Расход: учёба',
  E_installment_own: 'Расход: своя рассрочка',
  E_installment_family: 'Расход: семейная рассрочка',
  E_other: 'Расход: прочее',
  F_lent: 'Выдал в долг',
  F_lent_back: 'Мне вернули долг',
  F_borrowed: 'Взял в долг',
  F_borrowed_back: 'Вернул долг',
  T_transfer: 'Перевод между счетами',
  T_savings_out: 'Перевод на сбережения вне приложения',
  T_savings_in: 'Возврат со сбережений вне приложения',
  T_correction: 'Корректировка / начальный остаток',
  UNCLASSIFIED: 'Не размечено',
};

export type ClassGroup = 'income' | 'expense' | 'financing' | 'technical' | 'unclassified';

export function classGroup(c: OpClass): ClassGroup {
  if (c === 'UNCLASSIFIED') return 'unclassified';
  if (c.startsWith('I_') || c.startsWith('U_I_')) return 'income';
  if (c.startsWith('E_') || c.startsWith('U_E_')) return 'expense';
  if (c.startsWith('F_')) return 'financing';
  return 'technical';
}

const ALLOWED: Record<Operation['kind'], ReadonlySet<OpClass>> = {
  income: new Set<OpClass>([...INCOME_CLASSES, 'F_lent_back', 'F_borrowed', 'T_savings_in', 'T_correction']),
  expense: new Set<OpClass>([...EXPENSE_CLASSES, 'F_lent', 'F_borrowed_back', 'T_savings_out', 'T_correction']),
  transfer: new Set<OpClass>(['T_transfer']),
};

/** Может ли операция такого вида получить такой класс (доходный класс у расхода — нет). */
export function isAllowedClass(kind: Operation['kind'], c: OpClass): boolean {
  if (c.startsWith('U_E_')) return kind === 'expense';
  if (c.startsWith('U_I_')) return kind === 'income';
  return ALLOWED[kind].has(c);
}

export interface Refinement {
  /** Любой из тегов (по названию, без учёта регистра). */
  tags?: string[];
  /** Группа тегов из настроек. */
  tagGroup?: 'family';
  /** Подстрока комментария, без учёта регистра. */
  commentContains?: string;
  class: OpClass;
}

export interface CategoryRule {
  categoryId?: string;
  categoryTitle?: string;
  opKind?: 'income' | 'expense';
  class: OpClass;
  refine?: Refinement[];
}

export interface ClassificationSettings {
  rules: CategoryRule[];
  /** Теги, которые делают рассрочку «семейной». */
  familyTags: string[];
}

/** Правила по умолчанию — ровно из инструкции §3.2 (DECISIONS D13). */
export const DEFAULT_CLASSIFICATION: ClassificationSettings = {
  familyTags: [],
  rules: [
    { categoryTitle: 'Накопительный счёт', opKind: 'expense', class: 'T_savings_out' },
    { categoryTitle: 'Накопление', opKind: 'income', class: 'T_savings_in' },
    { categoryTitle: 'Долг', class: 'F_lent' },
    { categoryTitle: 'Возвращают долг', class: 'F_lent_back' },
    { categoryTitle: 'Беру в долг', class: 'F_borrowed' },
    { categoryTitle: 'Возвращаю долг', class: 'F_borrowed_back' },
    { categoryTitle: 'Бонус', class: 'I_cashback' },
    { categoryTitle: 'Размен', class: 'T_correction' },
    { categoryTitle: 'Рассрочка', class: 'E_installment_own', refine: [{ tagGroup: 'family', class: 'E_installment_family' }] },
  ],
};

const norm = (s: string) => s.trim().toLowerCase().replace(/ё/g, 'е');

/**
 * Подсказка класса по названию категории (D72): частые слова, а не названия категорий одного человека.
 * Только подсказка — класс назначает пользователь. Порядок важен: первое совпадение.
 */
const HINTS: { kind: 'income' | 'expense'; re: RegExp; cls: OpClass }[] = [
  { kind: 'expense', re: /дал в долг|одолжил|выдал/, cls: 'F_lent' },
  { kind: 'expense', re: /вернул долг|возвращаю долг|отдал долг|погасил долг/, cls: 'F_borrowed_back' },
  { kind: 'income', re: /вернули долг|возвращают долг|вернул(и)? мне/, cls: 'F_lent_back' },
  { kind: 'income', re: /занял|беру в долг|взял в долг|займ/, cls: 'F_borrowed' },
  { kind: 'expense', re: /накоп|сбереж|копилк|депозит|вклад|отложил/, cls: 'T_savings_out' },
  { kind: 'income', re: /накоп|сбереж|копилк|депозит|вклад/, cls: 'T_savings_in' },
  { kind: 'expense', re: /рассроч|кредит|ипотек|0-0-/, cls: 'E_installment_own' },
  { kind: 'income', re: /зарплат|аванс|оклад|подработ|премия/, cls: 'I_work' },
  { kind: 'income', re: /стипенд/, cls: 'I_stipend' },
  { kind: 'income', re: /кэшб|кешб|cashback|бонус/, cls: 'I_cashback' },
  { kind: 'income', re: /подар/, cls: 'I_gift' },
  { kind: 'expense', re: /продукт|супермаркет|аренд|квартплат|коммунал|связь|интернет|мобильн|проезд|транспорт|гигиен|бытов/, cls: 'E_base' },
  { kind: 'expense', re: /аптек|лекарств|врач|медиц|здоров|стоматол|клиник/, cls: 'E_health' },
  { kind: 'expense', re: /курс|учеб|образован|репетит|книг/, cls: 'E_edu' },
  { kind: 'expense', re: /кафе|ресторан|кино|развлеч|игр|доставк/, cls: 'E_fun' },
  { kind: 'expense', re: /семь|родител|мам|пап/, cls: 'E_family' },
];

export function suggestClassForCategory(label: string, kind: 'income' | 'expense'): OpClass | null {
  const t = norm(label);
  if (!t) return null;
  return HINTS.find((x) => x.kind === kind && x.re.test(t))?.cls ?? null;
}

export interface ClassifiedOp {
  op: Operation;
  cls: OpClass;
  /** Человекочитаемое объяснение, откуда класс. */
  reason: string;
  ruleIndex: number | null;
}

export interface UnclassifiedGroup {
  categoryId: string | null;
  label: string;
  opKind: 'income' | 'expense';
  count: number;
  total: Money;
  reason: 'no_rule' | 'conflict';
}

export interface ClassificationReport {
  ops: ClassifiedOp[];
  complete: boolean;
  unclassified: UnclassifiedGroup[];
  /** Только классы, которые встретились, плюс все встроенные (с нулями). */
  byClass: Record<OpClass, { count: number; total: Money }>;
}

interface Ctx {
  categories: Map<string, Category>;
  tagNames: Map<string, string>;
  settings: ClassificationSettings;
}

function findRule(op: Operation & { kind: 'income' | 'expense' }, cat: Category, s: ClassificationSettings): number {
  const kindOk = (r: CategoryRule) => !r.opKind || r.opKind === op.kind;
  const byId = s.rules.findIndex((r) => r.categoryId === cat.id && kindOk(r));
  if (byId >= 0) return byId;
  const t = norm(cat.title);
  if (!t) return -1;
  return s.rules.findIndex((r) => !r.categoryId && r.categoryTitle !== undefined && norm(r.categoryTitle) === t && kindOk(r));
}

function refinementMatches(ref: Refinement, op: Operation & { kind: 'income' | 'expense' }, ctx: Ctx): boolean {
  const opTags = op.tagIds.map((id) => norm(ctx.tagNames.get(id) ?? ''));
  if (ref.tags && !ref.tags.some((t) => opTags.includes(norm(t)))) return false;
  if (ref.tagGroup === 'family' && !ctx.settings.familyTags.some((t) => opTags.includes(norm(t)))) return false;
  if (ref.commentContains !== undefined && !norm(op.comment).includes(norm(ref.commentContains))) return false;
  return ref.tags !== undefined || ref.tagGroup !== undefined || ref.commentContains !== undefined;
}

function classifyOne(op: Operation, ctx: Ctx): ClassifiedOp {
  if (op.kind === 'transfer') return { op, cls: 'T_transfer', reason: 'перевод между своими счетами', ruleIndex: null };
  if (op.categoryId === null) return { op, cls: 'T_correction', reason: 'операция без категории — корректировка или начальный остаток', ruleIndex: null };
  const cat = ctx.categories.get(op.categoryId);
  if (!cat) return { op, cls: 'UNCLASSIFIED', reason: 'категория не найдена', ruleIndex: null };
  const ri = findRule(op, cat, ctx.settings);
  if (ri < 0) return { op, cls: 'UNCLASSIFIED', reason: `нет правила для категории «${cat.label}»`, ruleIndex: null };
  const rule = ctx.settings.rules[ri]!;
  let cls = rule.class;
  let reason = `правило: «${cat.label}» → ${cls}`;
  for (const ref of rule.refine ?? []) {
    if (refinementMatches(ref, op, ctx)) {
      cls = ref.class;
      reason += `, уточнено → ${cls}`;
      break;
    }
  }
  if (!isAllowedClass(op.kind, cls)) {
    return { op, cls: 'UNCLASSIFIED', reason: `конфликт правила: класс ${cls} недопустим для ${op.kind === 'income' ? 'дохода' : 'расхода'}`, ruleIndex: ri };
  }
  return { op, cls, reason, ruleIndex: ri };
}

const opAbs = (op: Operation): Money => (op.kind === 'transfer' ? op.fromAmount : op.amount);

export function classifyAll(data: Pick<ImportedData, 'operations' | 'categories' | 'tags'>, settings: ClassificationSettings): ClassificationReport {
  const ctx: Ctx = {
    categories: new Map(data.categories.map((c) => [c.id, c])),
    tagNames: new Map(data.tags.map((t) => [t.id, t.name])),
    settings,
  };
  const ops = data.operations.map((op) => classifyOne(op, ctx));
  const byClass = Object.fromEntries(ALL_CLASSES.map((c) => [c, { count: 0, total: ZERO }])) as ClassificationReport['byClass'];
  const groups = new Map<string, UnclassifiedGroup>();
  for (const c of ops) {
    const b = (byClass[c.cls] ??= { count: 0, total: ZERO });
    b.count++;
    b.total = add(b.total, opAbs(c.op));
    if (c.cls === 'UNCLASSIFIED' && c.op.kind !== 'transfer') {
      const key = `${c.op.categoryId}|${c.op.kind}`;
      let g = groups.get(key);
      if (!g) {
        const cat = c.op.categoryId ? ctx.categories.get(c.op.categoryId) : undefined;
        g = {
          categoryId: c.op.categoryId,
          label: cat?.label ?? '(нет категории)',
          opKind: c.op.kind,
          count: 0,
          total: ZERO,
          reason: c.reason.startsWith('конфликт') ? 'conflict' : 'no_rule',
        };
        groups.set(key, g);
      }
      g.count++;
      g.total = add(g.total, c.op.amount);
    }
  }
  const unclassified = [...groups.values()].sort((a, b) => b.total - a.total || (a.label < b.label ? -1 : 1));
  return { ops, complete: unclassified.length === 0, unclassified, byClass };
}

/**
 * Разметка категории из UI: заменяет правило для этой категории (по uid) или добавляет новое.
 * Возвращает новые настройки, исходные не меняются.
 */
export function setCategoryClass(settings: ClassificationSettings, category: Category, cls: OpClass, opKind?: 'income' | 'expense'): ClassificationSettings {
  const rules = settings.rules.filter((r) => !(r.categoryId === category.id && (r.opKind ?? null) === (opKind ?? null)));
  rules.push({ categoryId: category.id, categoryTitle: category.label, class: cls, ...(opKind ? { opKind } : {}) });
  return { ...settings, rules };
}

export type ValidationResult<T> = { ok: true; value: T; errors: [] } | { ok: false; errors: string[] };

/** Проверка правил, введённых вручную (JSON в настройках). */
export function validateClassification(raw: unknown, knownCustom: readonly string[] = []): ValidationResult<ClassificationSettings> {
  const known = (c: unknown) => typeof c === 'string' && (ALL_CLASSES.includes(c as BuiltinClass) || knownCustom.includes(c));
  const errors: string[] = [];
  const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
  if (!isObj(raw)) return { ok: false, errors: ['Ожидается объект { rules: [...], familyTags: [...] }'] };
  if (!Array.isArray(raw.familyTags) || raw.familyTags.some((t) => typeof t !== 'string')) errors.push('familyTags должен быть списком строк');
  if (!Array.isArray(raw.rules)) {
    errors.push('rules должен быть списком');
  } else {
    raw.rules.forEach((r, i) => {
      const n = `Правило ${i + 1}`;
      if (!isObj(r)) return errors.push(`${n}: ожидается объект`);
      if (!known(r.class)) errors.push(`${n}: неизвестный класс «${String(r.class)}»`);
      if (typeof r.categoryId !== 'string' && typeof r.categoryTitle !== 'string') errors.push(`${n}: нужна категория (categoryId или categoryTitle)`);
      if (r.opKind !== undefined && r.opKind !== 'income' && r.opKind !== 'expense') errors.push(`${n}: opKind — income или expense`);
      if (r.refine !== undefined) {
        if (!Array.isArray(r.refine)) errors.push(`${n}: refine должен быть списком`);
        else
          r.refine.forEach((f, j) => {
            if (!isObj(f) || !known(f.class)) errors.push(`${n}, уточнение ${j + 1}: неизвестный класс`);
            else if (f.tags === undefined && f.tagGroup === undefined && f.commentContains === undefined) errors.push(`${n}, уточнение ${j + 1}: нужно условие (tags, tagGroup или commentContains)`);
          });
      }
    });
  }
  if (errors.length) return { ok: false, errors };
  return { ok: true, value: raw as unknown as ClassificationSettings, errors: [] };
}
