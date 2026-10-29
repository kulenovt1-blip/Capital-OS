/**
 * Замер когнитивной сложности интерфейса (bun scripts/complexity-audit.ts [метка]).
 *
 * Зачем: задача «сделать понятным для всех» должна измеряться, а не оцениваться на глаз.
 * Скрипт открывает каждый экран на телефоне (390×844) в нескольких состояниях данных и считает:
 *   words     — слов видимого текста в контенте экрана;
 *   screens   — высота страницы в экранах телефона;
 *   controls  — видимых элементов, на которые можно нажать или ввести (button, a, select, input, textarea, summary);
 *   fields    — полей ввода (input, select, textarea) — каждое поле = решение, которое надо принять;
 *   jargon    — какие понятия из словаря сложности встречаются в тексте (см. JARGON ниже);
 *   info      — кнопок ⓘ (каждая = понятие, которое без объяснения непонятно);
 *   amounts   — сумм в ₸ на экране.
 * Плюс сводка по всему приложению: сколько разных понятий человек встречает, сколько всего полей.
 *
 * Нужен запущенный сервер: PORT=5199 bun scripts/dev-server.ts &
 * Результат: ui-shots/complexity/<метка>.json и таблица Markdown в stdout.
 * Сравнение: bun scripts/complexity-audit.ts after && сравнить с docs/simplify/baseline.md.
 */
// @ts-nocheck — служебный скрипт для Bun
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { serializeState } from '../engine/index';
import { HELP } from '../app/help-text';
import { BASE, TODAY, STATES, SCREENS, put } from './ui-states';

const ROOT = join(import.meta.dir, '..');
const label = process.argv[2] ?? 'current';
const OUT = join(ROOT, 'ui-shots', 'complexity');
mkdirSync(OUT, { recursive: true });

/**
 * Словарь сложности: понятия, которые человек без финансовой подготовки не поймёт без объяснения
 * или которые описывают устройство расчёта, а не его жизнь. Берутся все заголовки глоссария ⓘ
 * плюс термины настроек, которых в глоссарии нет. Поиск — по основе слова, без учёта регистра.
 */
const EXTRA = [
  'роль', 'важност', 'гибк', 'подцел', 'комфортн', 'минимум', 'горизонт', 'срочност',
  'стратеги', 'Безопасность', 'Ускорение', 'недофинанс', 'Не распределено', 'Закрепить', 'закреплен',
  'сценари', 'Хуже', 'Лучше', 'инфляц', 'капитализац', 'ставк', 'ликвидн', 'Когда можно снять',
  'Не учитывать', 'технический', 'нерегулярн', 'временн', 'регулярн', 'Как считать в прогнозе', 'вид дохода',
  'Свои типы', 'Плановые события', 'Что если', 'Альтернатив', 'Проверить решение', 'медиан', 'обычный месяц',
  'Сбережения вне', 'оценк', 'сверк', 'Для продвинутых', 'коэффициент', 'доля', 'б.п.',
];
const JARGON = [...new Map([...Object.values(HELP).map((h: { title: string }) => h.title), ...EXTRA].map((t) => [t.toLowerCase(), t])).values()];

/** Состояние → экраны. «empty» — первый запуск, «imported» — сразу после импорта, «configured» — всё настроено. */
const PLAN: [string, string[]][] = [
  ['empty', ['overview', 'goals', 'income', 'forecast', 'more', 'import']],
  ['imported', ['overview', 'setup', 'setup-classes', 'setup-income', 'setup-obligations', 'setup-goals', 'markup', 'goals', 'forecast']],
  ['configured', ['overview', 'goals', 'goal-new', 'goal-sheet', 'goal-fund', 'goal-edit', 'income', 'income-result', 'forecast', 'fc-events', 'fc-whatif',
    'more', 'markup', 'accounts', 'account-sheet', 'incomes', 'income-kinds', 'debts', 'backup', 'rare', 'advanced', 'adv-rules', 'adv-params', 'adv-scenarios']],
];

const browser = await chromium.launch();
const rows: any[] = [];
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1 });
const page = await ctx.newPage();
for (const [stateName, screens] of PLAN) {
  await page.goto(`${BASE}/?today=${TODAY}`);
  await put(page, serializeState(STATES[stateName]!(), TODAY));
  for (const name of screens) {
    const hash = SCREENS.find(([s]) => s === name)?.[1];
    if (!hash) continue;
    await page.goto(`${BASE}/?today=${TODAY}${hash}`);
    await page.reload();
    await page.waitForTimeout(350);
    if (name === 'income-result') {
      const amount = page.locator('input[name=amount]').first();
      await amount.fill('180000');
      await amount.press('Enter');
      await page.waitForTimeout(900);
    }
    const m = await page.evaluate((jargon: string[]) => {
      // открытый подэкран (sheet) перекрывает экран — меряем его, иначе основной контент
      const sheet = [...document.querySelectorAll('.sheet[role=dialog]')].find((e) => (e as HTMLElement).getBoundingClientRect().height > 0) as HTMLElement | undefined;
      const root = sheet ?? (document.querySelector('main') as HTMLElement | null) ?? document.body;
      const visible = (el: Element) => {
        const r = (el as HTMLElement).getBoundingClientRect();
        const s = getComputedStyle(el as HTMLElement);
        return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none';
      };
      const text = root.innerText ?? '';
      const words = (text.match(/[\p{L}\d][\p{L}\d.,%-]*/gu) ?? []).length;
      const controls = [...root.querySelectorAll('button, a[href], select, input:not([type=hidden]), textarea, summary')].filter(visible);
      const fields = controls.filter((e) => /^(INPUT|SELECT|TEXTAREA)$/.test(e.tagName));
      const lower = text.toLowerCase();
      const hit = jargon.filter((j) => lower.includes(j.toLowerCase()));
      // «Сверка» и «сверк», «Сбережения вне» и «Сбережения вне MoneyManager» — одно понятие: короткое совпадение внутри длинного не считаем
      const found = hit.filter((j) => !hit.some((k) => k !== j && k.toLowerCase().includes(j.toLowerCase())));
      const info = [...root.querySelectorAll('button.info')].filter(visible).length;
      const amounts = (text.match(/\d[\d\s ]*(,\d+)?\s?₸/g) ?? []).length;
      const tall = sheet ? sheet.scrollHeight : document.documentElement.scrollHeight;
      return { words, screens: +(tall / innerHeight).toFixed(1), controls: controls.length, fields: fields.length, jargon: found, info, amounts };
    }, JARGON);
    rows.push({ state: stateName, screen: name, ...m });
  }
}
await browser.close();

const allHits = [...new Set(rows.flatMap((r) => r.jargon))];
const allJargon = new Set(allHits.filter((j) => !allHits.some((k) => k !== j && k.toLowerCase().includes(j.toLowerCase()))));
const summary = {
  label,
  date: new Date().toISOString().slice(0, 10),
  screensMeasured: rows.length,
  distinctJargon: allJargon.size,
  jargonList: [...allJargon].sort(),
  glossaryEntries: Object.keys(HELP).length,
  totalFieldsConfigured: rows.filter((r) => r.state === 'configured').reduce((s, r) => s + r.fields, 0),
  maxScreensTall: Math.max(...rows.map((r) => r.screens)),
};
writeFileSync(join(OUT, `${label}.json`), JSON.stringify({ summary, rows }, null, 2));

const md = [
  `| Состояние | Экран | Слов | Высота, экранов | Нажимаемых | Полей | Понятий | ⓘ | Сумм |`,
  `|---|---|---|---|---|---|---|---|---|`,
  ...rows.map((r) => `| ${r.state} | ${r.screen} | ${r.words} | ${r.screens} | ${r.controls} | ${r.fields} | ${r.jargon.length} | ${r.info} | ${r.amounts} |`),
].join('\n');
console.log(md);
console.log('\nСводка:', JSON.stringify(summary, null, 2));
