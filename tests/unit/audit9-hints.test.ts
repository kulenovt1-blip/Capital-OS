import { describe, expect, it } from 'vitest';
import { suggestClassForCategory as s } from '../../engine/index';

describe('L14: подсказки категорий на русском, английском и казахском', () => {
  it('стандартные категории MoneyManager (английские)', () => {
    expect(s('Food', 'expense')).toBe('E_base');
    expect(s('Transport', 'expense')).toBe('E_base');
    expect(s('Household', 'expense')).toBe('E_base');
    expect(s('Health', 'expense')).toBe('E_health');
    expect(s('Social Life', 'expense')).toBe('E_fun');
    expect(s('Beauty', 'expense')).toBe('E_fun');
    expect(s('Education', 'expense')).toBe('E_edu');
    expect(s('Apparel', 'expense')).toBe('E_other');
    expect(s('Gift', 'expense')).toBe('E_other');
    expect(s('Salary', 'income')).toBe('I_work');
    expect(s('Allowance', 'income')).toBe('I_gift');
  });
  it('частые русские слова', () => {
    for (const w of ['Такси', 'Бензин', 'Питание']) expect(s(w, 'expense')).toBe('E_base');
    for (const w of ['Одежда', 'Подписки', 'Налоги', 'Штрафы', 'Страховка', 'Животные']) expect(s(w, 'expense')).toBe('E_other');
    for (const w of ['Дети', 'Садик']) expect(s(w, 'expense')).toBe('E_family');
    expect(s('Красота', 'expense')).toBe('E_fun');
  });
  it('казахские названия', () => {
    expect(s('Азық-түлік', 'expense')).toBe('E_base');
    expect(s('Көлік', 'expense')).toBe('E_base');
    expect(s('Денсаулық', 'expense')).toBe('E_health');
    expect(s('Білім', 'expense')).toBe('E_edu');
    expect(s('Жалақы', 'income')).toBe('I_work');
  });
  it('слова внутри других слов не срабатывают (parent ≠ rent, carpet ≠ pet)', () => {
    expect(s('Parents', 'expense')).toBe('E_family');
    expect(s('Carpet', 'expense')).toBeNull();
    expect(s('Competition', 'expense')).toBeNull();
  });
  it('прежние подсказки не сломаны', () => {
    expect(s('Продукты', 'expense')).toBe('E_base');
    expect(s('Стипендия', 'income')).toBe('I_stipend');
    expect(s('Аптека', 'expense')).toBe('E_health');
  });
});
