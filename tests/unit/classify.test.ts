import { describe, it, expect } from 'vitest';
import {
  classifyAll, DEFAULT_CLASSIFICATION, setCategoryClass, isAllowedClass, classGroup, CLASS_LABELS, ALL_CLASSES, type ClassificationSettings,
} from '../../engine/classify';
import { importMmbackup } from '../../engine/import/mmbackup';
import { fixtureBytes } from '../support/fixtures';
import { acc, cat, dataset, exp, inc, trf } from '../support/build';

const cats = [
  cat('c-food', 'Продукты'),
  cat('c-save', 'Накопительный счет'), // «е» вместо «ё» — должно совпасть с правилом
  cat('c-save-in', 'Накопление', 'income'),
  cat('c-inst', 'Рассрочка'),
  cat('c-lent', 'Долг'),
  cat('c-lent-back', 'Возвращают долг', 'income'),
  cat('c-borrow', 'Беру в долг', 'income'),
  cat('c-repay', 'Возвращаю долг'),
  cat('c-bonus', 'Бонус', 'income'),
  cat('c-exch', 'Размен'),
];
const tags = [
  { id: 'tg-mom', name: 'Мама' },
  { id: 'tg-phone', name: 'телефон' },
];

describe('классификация: правила по умолчанию (§3.2)', () => {
  const settings: ClassificationSettings = { ...DEFAULT_CLASSIFICATION, familyTags: ['мама'] };
  const data = dataset({
    accounts: [acc('a'), acc('b')],
    categories: cats,
    tags,
    operations: [
      exp('2026-10-01', 'a', 100, 'c-food'),
      exp('2026-10-02', 'a', 50000, 'c-save'),
      inc('2026-10-03', 'a', 20000, 'c-save-in'),
      exp('2026-10-05', 'a', 30285, 'c-inst', ['tg-phone']),
      exp('2026-10-06', 'a', 15000, 'c-inst', ['tg-mom']),
      exp('2026-10-07', 'a', 10000, 'c-lent'),
      inc('2026-10-08', 'a', 10000, 'c-lent-back'),
      inc('2026-10-09', 'a', 5000, 'c-borrow'),
      exp('2026-10-10', 'a', 3000, 'c-repay'),
      inc('2026-10-11', 'a', 300, 'c-bonus'),
      exp('2026-10-12', 'a', 100, 'c-exch'),
      inc('2026-10-13', 'a', 150000, null, [], 'Начальный остаток'),
      trf('2026-10-14', 'a', 'b', 1000),
    ],
  });
  const rep = classifyAll(data, settings);
  const clsOf = (i: number) => rep.ops[i]!.cls;

  it('каждая операция получает ровно один класс', () => {
    expect(rep.ops.length).toBe(data.operations.length);
    for (const c of rep.ops) expect(ALL_CLASSES).toContain(c.cls);
  });

  it('применяет правила из инструкции', () => {
    expect(rep.ops.map((o) => o.cls)).toEqual([
      'UNCLASSIFIED',
      'T_savings_out',
      'T_savings_in',
      'E_installment_own',
      'E_installment_family',
      'F_lent',
      'F_lent_back',
      'F_borrowed',
      'F_borrowed_back',
      'I_cashback',
      'T_correction',
      'T_correction',
      'T_transfer',
    ]);
    expect(clsOf(0)).toBe('UNCLASSIFIED');
  });

  it('отчёт неполный, пока есть UNCLASSIFIED, и группирует их по категории', () => {
    expect(rep.complete).toBe(false);
    expect(rep.unclassified).toEqual([{ categoryId: 'c-food', label: 'Продукты', opKind: 'expense', count: 1, total: 10000, reason: 'no_rule' }]);
  });

  it('разметка категории в UI создаёт правило и снимает UNCLASSIFIED', () => {
    const s2 = setCategoryClass(settings, cats[0]!, 'E_base');
    const rep2 = classifyAll(data, s2);
    expect(rep2.complete).toBe(true);
    expect(rep2.ops[0]!.cls).toBe('E_base');
    // повторная разметка заменяет правило, а не дублирует
    const s3 = setCategoryClass(s2, cats[0]!, 'E_fun');
    expect(s3.rules.filter((r) => r.categoryId === 'c-food').length).toBe(1);
    expect(classifyAll(data, s3).ops[0]!.cls).toBe('E_fun');
  });

  it('суммы по классам', () => {
    expect(rep.byClass.T_correction).toEqual({ count: 2, total: 15_010_000 }); // модули сумм: 150 000 ₸ + 100 ₸
    expect(rep.byClass.E_installment_own.total).toBe(3028500);
  });
});

describe('классификация: уточнения и конфликты', () => {
  it('уточнение по подстроке комментария', () => {
    const s: ClassificationSettings = {
      familyTags: [],
      rules: [{ categoryTitle: 'Подарки', class: 'I_gift', refine: [{ commentContains: 'ПРОЦЕНТЫ', class: 'I_interest' }] }],
    };
    const d = dataset({
      accounts: [acc('a')],
      categories: [cat('g', 'Подарки', 'income')],
      operations: [inc('2026-01-01', 'a', 1, 'g', [], 'проценты по депозиту'), inc('2026-01-02', 'a', 1, 'g', [], 'от бабушки')],
    });
    expect(classifyAll(d, s).ops.map((o) => o.cls)).toEqual(['I_interest', 'I_gift']);
  });

  it('правило по uid сильнее правила по названию', () => {
    const s: ClassificationSettings = {
      familyTags: [],
      rules: [
        { categoryTitle: 'Еда', class: 'E_fun' },
        { categoryId: 'food', class: 'E_base' },
      ],
    };
    const d = dataset({ accounts: [acc('a')], categories: [cat('food', 'Еда')], operations: [exp('2026-01-01', 'a', 1, 'food')] });
    expect(classifyAll(d, s).ops[0]!.cls).toBe('E_base');
  });

  it('правило с фильтром по типу операции не срабатывает на другом типе', () => {
    const d = dataset({ accounts: [acc('a')], categories: [cat('x', 'Накопление', 'expense')], operations: [exp('2026-01-01', 'a', 1, 'x')] });
    const r = classifyAll(d, DEFAULT_CLASSIFICATION);
    expect(r.ops[0]!.cls).toBe('UNCLASSIFIED');
  });

  it('конфликт: доходный класс у расходной операции → UNCLASSIFIED с причиной', () => {
    const s: ClassificationSettings = { familyTags: [], rules: [{ categoryTitle: 'Странная', class: 'I_work' }] };
    const d = dataset({ accounts: [acc('a')], categories: [cat('w', 'Странная')], operations: [exp('2026-01-01', 'a', 7, 'w')] });
    const r = classifyAll(d, s);
    expect(r.ops[0]!.cls).toBe('UNCLASSIFIED');
    expect(r.unclassified[0]!.reason).toBe('conflict');
    expect(r.ops[0]!.reason).toMatch(/конфликт/);
  });

  it('isAllowedClass и группы', () => {
    expect(isAllowedClass('income', 'F_borrowed')).toBe(true);
    expect(isAllowedClass('income', 'F_lent')).toBe(false);
    expect(isAllowedClass('expense', 'F_borrowed_back')).toBe(true);
    expect(isAllowedClass('expense', 'T_savings_in')).toBe(false);
    expect(isAllowedClass('transfer', 'T_transfer')).toBe(true);
    expect(classGroup('F_lent')).toBe('financing');
    expect(classGroup('T_correction')).toBe('technical');
    expect(classGroup('I_work')).toBe('income');
    expect(classGroup('E_base')).toBe('expense');
    expect(Object.keys(CLASS_LABELS).length).toBe(ALL_CLASSES.length);
  });
});

describe('классификация синтетического бэкапа', () => {
  it('правила по умолчанию + семейный тег «мама»', () => {
    const data = importMmbackup(fixtureBytes('synthetic.mmbackup'));
    const rep = classifyAll(data, { ...DEFAULT_CLASSIFICATION, familyTags: ['мама'] });
    expect(rep.byClass.E_installment_own.count).toBe(8);
    expect(rep.byClass.E_installment_family.count).toBe(8);
    expect(rep.byClass.T_transfer.count).toBe(11);
    expect(rep.byClass.T_correction.count).toBe(4 + 1); // 4 без категории + «Размен»
    expect(rep.byClass.F_lent.count).toBe(1);
    expect(rep.byClass.I_cashback.count).toBe(8);
    expect(rep.complete).toBe(false);
    const labels = rep.unclassified.map((u) => u.label);
    expect(labels).toContain('Продукты');
    expect(labels).toContain('Комиссия'); // D83: имя из иконки, а не код
    expect(labels).toContain('Старое');
  });
});

describe('валидация правил классификации из JSON (экран «Настройки»)', () => {
  it('корректные правила проходят, неизвестный класс и пустое правило — ошибки с номером правила', async () => {
    const { validateClassification } = await import('../../engine/classify');
    expect(validateClassification(DEFAULT_CLASSIFICATION)).toEqual({ ok: true, value: DEFAULT_CLASSIFICATION, errors: [] });
    const bad = validateClassification({ familyTags: ['мама'], rules: [{ categoryTitle: 'X', class: 'E_wrong' }, { class: 'E_base' }] });
    expect(bad.ok).toBe(false);
    expect(bad.errors.join('\n')).toMatch(/Правило 1.*E_wrong/);
    expect(bad.errors.join('\n')).toMatch(/Правило 2.*категори/);
    expect(validateClassification('мусор').ok).toBe(false);
    expect(validateClassification({ rules: [], familyTags: 'мама' }).ok).toBe(false);
  });
});
