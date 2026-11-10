/**
 * T09 «Положение» v4: признаки долговой спирали — диагностика, на `G` и уровень не влияет.
 *
 * Источники ожидаемых значений — НЕ код движка:
 *  1. таблица спец. 9.3: по 60 профилей на семейство (seed 1…60), число профилей с каждым признаком и со «спиралью»;
 *  2. спец. 9.3: ложных срабатываний на профилях без займов у людей и просрочек — 0 (по «спирали» и по любому признаку);
 *  3. ручная арифметика на синтетических рядах (границы порогов: 2 просрочки, 3 месяца из 6, шаг роста долга 1 тенге).
 * Тесты написаны до кода (правило «тесты вперёд»).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  spiralSigns, spiralOfState, SPIRAL_MIN_OVERDUE, SPIRAL_GROWTH_MONTHS, SPIRAL_BORROW_MONTHS, SPIRAL_WINDOW_MONTHS, SPIRAL_SIGNS_NEEDED,
} from '../../engine/position/spiral';
import { buildPositionSeries, type PositionSeries } from '../../engine/position/series';
import type { Money } from '../../engine/money';
import { emptyState } from '../../engine/state';
import { probeProfiles, spiralCase, SPIRAL_FAMS, TODAY, type SpiralFam } from '../support/position-profiles';

const T = (x: number): Money => Math.round(x * 100) as Money;

interface Fake {
  hasData?: boolean;
  overdue?: number;
  /** Долг людям, тенге: [0] — сейчас, [h] — h месяцев назад (h = 1…6); null — на эту дату данных нет. */
  payables?: (number | null)[];
  borrowed?: number[]; borrowedBack?: number[]; installments?: number[]; free?: number[];
}
/** Синтетический ряд: только поля, нужные признакам спирали (тиыны). Потоки идут по возрастанию месяцев, как в `PositionSeries`. */
function fake(f: Fake): PositionSeries {
  const n = (f.borrowed ?? f.free ?? []).length;
  const z = (): number[] => Array.from({ length: n }, () => 0);
  return {
    hasData: f.hasData ?? true,
    overdueCount: f.overdue ?? 0,
    payables: (f.payables ?? [0, 0, 0, 0, 0, 0, 0]).map((x) => (x === null ? null : T(x))),
    borrowed: (f.borrowed ?? z()).map(T),
    borrowedBack: (f.borrowedBack ?? z()).map(T),
    installmentsPaid: (f.installments ?? z()).map(T),
    free: (f.free ?? z()).map(T),
    months: Array.from({ length: n }, (_, i) => `2026-${String(i + 1).padStart(2, '0')}`),
  } as unknown as PositionSeries;
}

describe('константы', () => {
  it('пороги спецификации 9.3', () => {
    expect(SPIRAL_MIN_OVERDUE).toBe(2);
    expect(SPIRAL_WINDOW_MONTHS).toBe(6);
    expect(SPIRAL_GROWTH_MONTHS).toBe(3);
    expect(SPIRAL_BORROW_MONTHS).toBe(3);
    expect(SPIRAL_SIGNS_NEEDED).toBe(2);
  });
});

describe('признак 1: просрочки (≥ 2 платежей по графику, которых нет в операциях)', () => {
  it('один платёж — признака нет, но число просрочек видно для пометки «есть просрочки»', () => {
    const r = spiralSigns(fake({ overdue: 1, borrowed: [0, 0, 0, 0, 0, 0] }));
    expect(r.overdue).toBe(false);
    expect(r.overdueCount).toBe(1);
  });
  it('два платежа — признак есть', () => {
    expect(spiralSigns(fake({ overdue: 2, borrowed: [0, 0, 0, 0, 0, 0] })).overdue).toBe(true);
  });
  it('нет просрочек — нет признака', () => {
    const r = spiralSigns(fake({ overdue: 0, borrowed: [0, 0, 0, 0, 0, 0] }));
    expect(r.overdue).toBe(false);
    expect(r.overdueCount).toBe(0);
  });
  it('одна просрочка без других признаков — не спираль (семейство spiralB)', () => {
    expect(spiralSigns(fake({ overdue: 2, borrowed: [0, 0, 0, 0, 0, 0] })).spiral).toBe(false);
  });
});

describe('признак 2: рост долга людям (≥ 3 месяцев из 6 вверх и выше, чем 6 месяцев назад)', () => {
  const none = [0, 0, 0, 0, 0, 0];
  // p[0] — сейчас, p[6] — 6 месяцев назад
  it('рост в трёх месяцах из шести и итог выше — признак есть', () => {
    // от старых к новым: 0, 100, 100, 200, 200, 300, 300 → вверх в 3 шагах
    const r = spiralSigns(fake({ payables: [300, 300, 200, 200, 100, 100, 0], borrowed: none }));
    expect(r.growth).toBe(true);
    expect(r.growthMonths).toBe(3);
  });
  it('рост только в двух месяцах — признака нет', () => {
    const r = spiralSigns(fake({ payables: [200, 200, 200, 100, 100, 0, 0], borrowed: none }));
    expect(r.growth).toBe(false);
    expect(r.growthMonths).toBe(2);
  });
  it('рост в трёх месяцах, но сейчас долг не выше, чем 6 месяцев назад — признака нет', () => {
    // от старых к новым: 100, 200, 0, 100, 0, 100, 100 → вверх в трёх шагах, но итог (100) равен началу (100)
    const r = spiralSigns(fake({ payables: [100, 100, 0, 100, 0, 200, 100], borrowed: none }));
    expect(r.growthMonths).toBe(3);
    expect(r.growth).toBe(false);
  });
  it('шаг роста ровно 1 тенге не считается ростом (допуск как в пробе), 1 тенге и 1 тиын — считается', () => {
    const flat = spiralSigns(fake({ payables: [3, 2, 1, 0, 0, 0, 0], borrowed: none }));
    expect(flat.growthMonths).toBe(0);
    const eps = fake({ payables: [3, 2, 1, 0, 0, 0, 0], borrowed: none });
    // шаг 101 тиын — строго больше 1 тенге (100 тиын)
    eps.payables = [303, 202, 101, 0, 0, 0, 0].map((x) => x as Money);
    expect(spiralSigns(eps).growthMonths).toBe(3);
  });
  it('долг людям не растёт, но возвращается — признака нет', () => {
    expect(spiralSigns(fake({ payables: [0, 100, 200, 300, 400, 500, 600], borrowed: none })).growth).toBe(false);
  });
  it('нет данных на дату 6 месяцев назад — признак не проверен (null), а не «нет»', () => {
    const r = spiralSigns(fake({ payables: [300, 300, 200, 200, 100, 100, null], borrowed: none }));
    expect(r.growth).toBeNull();
    expect(r.growthMonths).toBeNull();
  });
});

describe('признак 3: займы ради платежей (≥ 3 из последних 6 месяцев: заём, платёж по долгу или возврат людям, остаток месяца < 0)', () => {
  const flat = [0, 0, 0, 0, 0, 0, 0];
  it('три месяца с займом при платеже по рассрочке и отрицательном остатке — признак есть', () => {
    const r = spiralSigns(fake({
      payables: flat,
      borrowed: [0, 0, 0, 50, 50, 50], installments: [10, 10, 10, 10, 10, 10], free: [5, 5, 5, -1, -1, -1],
    }));
    expect(r.borrowToPay).toBe(true);
    expect(r.borrowToPayMonths).toBe(3);
  });
  it('вместо платежа по рассрочке — возврат людям: тоже считается', () => {
    const r = spiralSigns(fake({
      payables: flat,
      borrowed: [50, 50, 50, 0, 0, 0], borrowedBack: [5, 5, 5, 0, 0, 0], installments: [0, 0, 0, 0, 0, 0], free: [-1, -1, -1, 5, 5, 5],
    }));
    expect(r.borrowToPayMonths).toBe(3);
    expect(r.borrowToPay).toBe(true);
  });
  it('только два подходящих месяца — признака нет', () => {
    const r = spiralSigns(fake({
      payables: flat,
      borrowed: [0, 0, 0, 0, 50, 50], installments: [10, 10, 10, 10, 10, 10], free: [5, 5, 5, 5, -1, -1],
    }));
    expect(r.borrowToPayMonths).toBe(2);
    expect(r.borrowToPay).toBe(false);
  });
  it('заём есть, но остаток месяца не отрицателен (нулевой тоже не отрицателен) — месяц не считается', () => {
    const r = spiralSigns(fake({
      payables: flat,
      borrowed: [50, 50, 50, 50, 50, 50], installments: [10, 10, 10, 10, 10, 10], free: [0, 0, 0, 0, 0, 0],
    }));
    expect(r.borrowToPayMonths).toBe(0);
  });
  it('заём есть, остаток отрицателен, но платежей по долгу и возвратов нет — месяц не считается', () => {
    const r = spiralSigns(fake({
      payables: flat,
      borrowed: [50, 50, 50, 50, 50, 50], installments: [0, 0, 0, 0, 0, 0], free: [-1, -1, -1, -1, -1, -1],
    }));
    expect(r.borrowToPayMonths).toBe(0);
  });
  it('считаются только последние 6 месяцев из 12', () => {
    const bad = [50, 50, 50, 50, 50, 50];
    const r = spiralSigns(fake({
      payables: flat,
      borrowed: [...bad, 0, 0, 0, 0, 0, 0], installments: Array(12).fill(10), free: [...Array(6).fill(-1), ...Array(6).fill(5)],
    }));
    expect(r.borrowToPayMonths).toBe(0);
  });
  it('история короче шести месяцев: три подходящих месяца уже достаточно (остальное признак только усилило бы)', () => {
    const r = spiralSigns(fake({
      payables: flat, borrowed: [50, 50, 50], installments: [10, 10, 10], free: [-1, -1, -1],
    }));
    expect(r.borrowToPay).toBe(true);
  });
  it('история короче шести месяцев, подходящих меньше трёх, а достроить до трёх ещё можно — не проверено (null)', () => {
    const r = spiralSigns(fake({
      payables: flat, borrowed: [50, 0, 0, 0], installments: [10, 10, 10, 10], free: [-1, 5, 5, 5],
    }));
    expect(r.borrowToPay).toBeNull();
  });
  it('две спокойные записи истории при окне 6: данных за остальные месяцы нет, проверить нельзя (null, а не «нет»)', () => {
    const r = spiralSigns(fake({ payables: flat, borrowed: [0, 0], installments: [10, 10], free: [5, 5] }));
    expect(r.borrowToPay).toBeNull();
  });
});

describe('«спираль» — выполнены ≥ 2 признака из трёх; неизвестный признак выполненным не считается', () => {
  const sixFlat = [0, 0, 0, 0, 0, 0];
  const growthP = [300, 300, 200, 200, 100, 100, 0];
  it('просрочки + рост долга → спираль', () => {
    const r = spiralSigns(fake({ overdue: 2, payables: growthP, borrowed: sixFlat }));
    expect(r.count).toBe(2);
    expect(r.spiral).toBe(true);
  });
  it('только рост долга → не спираль', () => {
    const r = spiralSigns(fake({ payables: growthP, borrowed: sixFlat }));
    expect(r.count).toBe(1);
    expect(r.spiral).toBe(false);
  });
  it('рост долга + займы ради платежей → спираль', () => {
    const r = spiralSigns(fake({
      payables: growthP, borrowed: [0, 0, 0, 50, 50, 50], installments: [10, 10, 10, 10, 10, 10], free: [5, 5, 5, -1, -1, -1],
    }));
    expect(r.growth && r.borrowToPay).toBe(true);
    expect(r.spiral).toBe(true);
  });
  it('все три → спираль, число признаков 3', () => {
    const r = spiralSigns(fake({
      overdue: 3, payables: growthP, borrowed: [0, 0, 0, 50, 50, 50], installments: [10, 10, 10, 10, 10, 10], free: [5, 5, 5, -1, -1, -1],
    }));
    expect(r.count).toBe(3);
    expect(r.spiral).toBe(true);
  });
  it('один признак выполнен, второй не проверен → спираль не объявляется', () => {
    const r = spiralSigns(fake({ overdue: 2, payables: [300, 300, 200, 200, 100, 100, null], borrowed: sixFlat }));
    expect(r.growth).toBeNull();
    expect(r.count).toBe(1);
    expect(r.spiral).toBe(false);
  });
});

describe('нет данных', () => {
  it('бэкап без операций: статус no_data, признаков нет, не NaN и не исключение', () => {
    const r = spiralSigns(fake({ hasData: false, borrowed: [] }));
    expect(r.status).toBe('no_data');
    expect(r.spiral).toBe(false);
    expect(r.overdue).toBeNull(); expect(r.growth).toBeNull(); expect(r.borrowToPay).toBeNull();
    expect(r.count).toBe(0);
  });
  it('пустое состояние через spiralOfState — то же', () => {
    const r = spiralOfState(emptyState(), TODAY);
    expect(r.status).toBe('no_data');
    expect(r.spiral).toBe(false);
  });
});

// ── эталон спецификации 9.3: 60 профилей на семейство ──
const SPEC_TABLE: Record<SpiralFam, { overdue: number; growth: number; borrowToPay: number; spiral: number }> = {
  spiralA: { overdue: 0, growth: 60, borrowToPay: 55, spiral: 55 },
  spiralB: { overdue: 60, growth: 0, borrowToPay: 0, spiral: 0 },
  spiralAB: { overdue: 60, growth: 60, borrowToPay: 0, spiral: 60 },
  heavyOK: { overdue: 0, growth: 0, borrowToPay: 0, spiral: 0 },
  mortgage: { overdue: 0, growth: 0, borrowToPay: 0, spiral: 0 },
  oneBorrow: { overdue: 0, growth: 0, borrowToPay: 0, spiral: 0 },
  friendBridge: { overdue: 0, growth: 0, borrowToPay: 0, spiral: 0 },
};

describe('таблица спец. 9.3: семь семейств × 60 профилей (seed 1…60)', () => {
  for (const fam of SPIRAL_FAMS) {
    it(`${fam}: просрочка / рост долга / займы ради платежей / спираль`, () => {
      const c = { overdue: 0, growth: 0, borrowToPay: 0, spiral: 0 };
      for (let seed = 1; seed <= 60; seed++) {
        const r = spiralOfState(spiralCase(seed, fam).state, TODAY);
        expect(r.status).toBe('ok');
        if (r.overdue) c.overdue++;
        if (r.growth) c.growth++;
        if (r.borrowToPay) c.borrowToPay++;
        if (r.spiral) c.spiral++;
      }
      expect(c).toEqual(SPEC_TABLE[fam]);
    }, 60_000);
  }
});

describe('ложные срабатывания: профили без займов у людей и просрочек', () => {
  it('нет ни «спирали», ни любого из трёх признаков (спец. 9.3)', () => {
    // семейства спирали (кроме тех, где займы и просрочки заложены) в этот список не входят; займы есть у oneBorrow/friendBridge — их проверяет таблица выше
    const profiles = probeProfiles().filter((p) => !p.family.startsWith('спираль:'));
    expect(profiles.length).toBeGreaterThan(100);
    const hits: string[] = [];
    for (const p of profiles) {
      const r = spiralOfState(p.state, TODAY);
      if (r.spiral || r.overdue || r.growth || r.borrowToPay) hits.push(p.name);
    }
    expect(hits).toEqual([]);
  }, 120_000);
});

describe('диагностика не влияет на `G` и уровни', () => {
  it('модуль не подключает расчёт уровней и ограничителей (в ограничителях по-прежнему ровно три, спирали среди них нет)', async () => {
    const src = readFileSync(fileURLToPath(new URL('../../engine/position/spiral.ts', import.meta.url)), 'utf8');
    expect(src).not.toMatch(/from '\.\/(level|limits|directions|range|unknown)'/);
    const { LIMIT_IDS } = await import('../../engine/position/limits');
    expect([...LIMIT_IDS]).toEqual(['cover1', 'gap', 'cliff']);
  });
  it('результат зависит только от рядов: два вызова на одном состоянии равны', () => {
    const st = spiralCase(7, 'spiralAB').state;
    expect(spiralOfState(st, TODAY)).toEqual(spiralOfState(st, TODAY));
    expect(spiralSigns(buildPositionSeries(st, TODAY))).toEqual(spiralOfState(st, TODAY));
  });
});
