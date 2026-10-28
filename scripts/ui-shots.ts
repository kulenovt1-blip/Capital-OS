/**
 * Скриншоты интерфейса для сравнения «до / после» (bun scripts/ui-shots.ts <этап>).
 *
 * Состояния собираются движком и кладутся прямо в IndexedDB — так снимки не зависят от того,
 * как устроены формы в текущей версии интерфейса. Нужен запущенный сервер:
 *   PORT=5199 bun scripts/dev-server.ts &
 * Снимки: ui-shots/<этап>/<состояние>-<экран>-<вариант>.png (папка в .gitignore).
 */
// @ts-nocheck — служебный скрипт для Bun
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { serializeState } from '../engine/index';
import { BASE, TODAY, STATES, SCREENS, put } from './ui-states';

const ROOT = join(import.meta.dir, '..');
const stage = process.argv[2] ?? 'current';
const only = process.argv[3]; // необязательно: снять только один экран
const OUT = join(ROOT, 'ui-shots', stage);
mkdirSync(OUT, { recursive: true });

/** Набор экранов: «before» — старые адреса; дальше — новые (старые ведут на них же). */
const NEW = ['overview', 'setup', 'goals', 'income', 'income-result', 'forecast', 'import', 'markup', 'more', 'accounts', 'incomes', 'debts', 'calc', 'goal-new', 'goal-sheet', 'goal-fund', 'goal-edit', 'fc-events', 'fc-whatif', 'fc-whatif-result', 'backup', 'install', 'rare', 'advanced', 'adv-rules', 'adv-params', 'adv-scenarios', 'account-sheet', 'savings', 'rare-manual', 'income-kinds'];
const PLAN: [string, string[]][] =
  stage === 'before'
    ? [
        ['configured', ['overview', 'setup', 'goals', 'income', 'income-result', 'forecast', 'import', 'classes', 'settings', 'calc']],
        ['imported', ['overview', 'setup', 'import', 'classes', 'forecast']],
        ['empty', ['overview', 'setup', 'goals', 'forecast']],
        ['broken', ['overview', 'import', 'income', 'forecast']],
      ]
    : [
        ['configured', NEW],
        ['imported', ['overview', 'setup', 'setup-classes', 'setup-income', 'setup-obligations', 'setup-goals', 'import', 'markup', 'forecast', 'goals']],
        ['empty', ['overview', 'setup', 'goals', 'forecast', 'import', 'more']],
        ['broken', ['overview', 'import', 'income', 'forecast', 'goals', 'more']],
      ];
const VARIANTS = [
  { name: 'phone', viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, colorScheme: 'light' as const },
  { name: 'laptop', viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1, colorScheme: 'light' as const },
  { name: 'dark', viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, colorScheme: 'dark' as const },
];

const browser = await chromium.launch();
let n = 0;
for (const v of VARIANTS) {
  for (const [stateName, screens] of PLAN) {
    if (v.name !== 'phone' && stateName !== 'configured') continue; // доп. состояния — только на телефоне
    const ctx = await browser.newContext({ viewport: v.viewport, deviceScaleFactor: v.deviceScaleFactor, colorScheme: v.colorScheme });
    const page = await ctx.newPage();
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(`${BASE}/?today=${TODAY}`);
    await put(page, serializeState(STATES[stateName]!(), TODAY));
    for (const name of screens) {
      if (only && name !== only) continue;
      const hash = SCREENS.find(([s]) => s === name)![1];
      await page.goto(`${BASE}/?today=${TODAY}${hash}`);
      await page.reload();
      await page.waitForTimeout(400);
      if (name === 'income-result') {
        const amount = page.locator('input[name=amount]').first();
        await amount.fill('180000');
        await amount.press('Enter');
        await page.waitForTimeout(900);
      }
      if (name === 'fc-whatif-result') {
        await page.locator('#fc-whatif-form select[name=kind]').selectOption('recurring_change');
        await page.locator('#fc-whatif-form input[name=title]').fill('Аренда');
        await page.locator('#fc-whatif-form input[name=amount]').fill('120000');
        await page.getByRole('button', { name: 'Добавить событие' }).click();
        await page.waitForTimeout(300);
        await page.getByRole('button', { name: 'Посчитать' }).click();
        await page.waitForTimeout(900);
      }
      await page.screenshot({ path: join(OUT, `${stateName}-${name}-${v.name}.png`), fullPage: true });
      n++;
    }
    if (errors.length) console.log(`${v.name}/${stateName}: ошибки страницы:`, errors);
    await ctx.close();
  }
}
await browser.close();
console.log(`${n} снимков → ${OUT}`);
