/**
 * Автопроверки интерфейса (bun scripts/ui-check.ts): каждый экран после импорта synthetic и broken-balance,
 * телефон в светлой и тёмной теме. Нужен запущенный сервер: PORT=5199 bun scripts/dev-server.ts &
 *
 * Проверяется:
 *  - в видимом тексте нет кодов и мусора (I_work, icon:, npm, localhost, R1, urgency, NaN, undefined, «0.0%», «: ,»);
 *  - всё, на что можно нажать, не меньше 44×44, поля ввода — 52 в высоту
 *    (исключение по WCAG 2.5.8 — ссылка внутри строки текста);
 *  - текст не мельче 13 px (кроме подписей осей графика);
 *  - контраст текста не ниже 4,5:1 (крупный жирный — 3:1);
 *  - у каждого поля есть подпись;
 *  - после broken-balance красная метка доверия с «Kaspi Gold» и «0,01» на «Обзоре», «Целях», «Доходе», «Прогнозе», в «Ещё»;
 *  - на «Обзоре» (390×844, synthetic) верх главной плашки выше 300 px.
 * Код выхода 1, если есть нарушения.
 */
// @ts-nocheck — служебный скрипт для Bun
import { chromium } from 'playwright';
import { serializeState } from '../engine/index';
import { BASE, TODAY, STATES, SCREENS, put } from './ui-states';

const FORBIDDEN: [RegExp, string][] = [
  [/\b[IEFTU]_[a-z_]+\b/i, 'код типа'],
  [/icon:/, 'icon:'],
  [/\bnpm\b/, 'npm'],
  [/localhost/, 'localhost'],
  [/\bR[12]\b/, 'R1/R2'],
  [/urgency/, 'urgency'],
  [/NaN/, 'NaN'],
  [/undefined/, 'undefined'],
  [/\d\.\d\s?%/, 'процент с точкой'],
  [/: ,/, '«: ,»'],
];

const CONFIGURED = ['overview', 'goals', 'goal-new', 'goal-sheet', 'goal-fund', 'goal-edit', 'income', 'income-result', 'forecast', 'fc-events', 'fc-whatif', 'fc-whatif-result', 'more', 'setup', 'import', 'markup', 'accounts', 'account-sheet', 'savings', 'incomes', 'income-kinds', 'debts', 'backup', 'install', 'rare', 'rare-manual', 'advanced', 'adv-rules', 'adv-params', 'adv-scenarios'];
const PLAN: [string, string[]][] = [
  ['configured', CONFIGURED],
  ['imported', ['overview', 'setup', 'setup-classes', 'setup-income', 'setup-obligations', 'setup-goals', 'markup', 'forecast', 'goals', 'debts']],
  ['empty', ['overview', 'setup', 'goals', 'income', 'forecast', 'import', 'more']],
  ['broken', ['overview', 'goals', 'income', 'forecast', 'more', 'import']],
];
const TRUST_SCREENS = new Set(['overview', 'goals', 'income', 'forecast', 'more']);

/** Проверки внутри страницы: возвращает список нарушений. */
function inPage(): string[] {
  const out: string[] = [];
  const visible = (el: Element) => {
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none' && !el.closest('[hidden]') && !el.closest('.skip');
  };
  const name = (el: Element) => `${el.tagName.toLowerCase()}${el.className && typeof el.className === 'string' ? '.' + el.className.trim().split(/\s+/).join('.') : ''} «${(el.textContent ?? '').trim().slice(0, 30) || el.getAttribute('aria-label') || ''}»`;

  // цели нажатия
  for (const el of document.querySelectorAll('button, a[href], summary, select, input:not([type=hidden]), textarea')) {
    if (!visible(el) || el.classList.contains('visually-hidden')) continue;
    const cs = getComputedStyle(el);
    if (el.tagName === 'A' && cs.display === 'inline') continue; // ссылка внутри строки текста
    let target: Element = el;
    if (el.matches('input[type=checkbox], input[type=radio]')) target = el.closest('label') ?? el;
    const r = target.getBoundingClientRect();
    const field = el.matches('input:not([type=checkbox]):not([type=radio]):not([type=file]), select, textarea');
    const minH = field ? 52 : 44;
    if (r.width < 43.5 || r.height < minH - 0.5) out.push(`мелкая цель ${Math.round(r.width)}×${Math.round(r.height)}: ${name(el)}`);
  }

  // подписи у полей
  for (const el of document.querySelectorAll('input:not([type=hidden]), select, textarea')) {
    if (!visible(el) && !(el as HTMLInputElement).type?.includes('file')) continue;
    const labelled = el.getAttribute('aria-label') || el.getAttribute('aria-labelledby') || (el as HTMLInputElement).labels?.length || el.closest('label');
    if (!labelled) out.push(`поле без подписи: ${name(el)}`);
  }

  // размер текста и контраст: элементы с собственным текстом
  const parse = (c: string) => {
    const m = c.match(/rgba?\(([^)]+)\)/);
    if (!m) return null;
    const [r, g, b, a = '1'] = m[1]!.split(/\s*,\s*/);
    return [Number(r), Number(g), Number(b), Number(a)];
  };
  const lum = ([r, g, b]: number[]) => {
    const f = (v: number) => {
      v /= 255;
      return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
    };
    return 0.2126 * f(r!) + 0.7152 * f(g!) + 0.0722 * f(b!);
  };
  const bgOf = (el: Element | null): number[] => {
    const layers: number[][] = [];
    for (let e = el; e; e = e.parentElement) {
      const c = parse(getComputedStyle(e).backgroundColor);
      if (c && c[3]! > 0) {
        layers.push(c);
        if (c[3]! >= 1) break;
      }
    }
    let base = parse(getComputedStyle(document.documentElement).backgroundColor) ?? [255, 255, 255, 1];
    if (base[3] === 0) base = parse(getComputedStyle(document.body).backgroundColor) ?? [255, 255, 255, 1];
    for (const l of layers.reverse()) base = [0, 1, 2].map((i) => l[i]! * l[3]! + base[i]! * (1 - l[3]!)).concat(1);
    return base;
  };
  const seen = new Set<string>();
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    if (!n.textContent?.trim()) continue;
    const el = n.parentElement;
    if (!el || !visible(el) || el.closest('svg, script, style, option, .visually-hidden')) continue;
    if (el.closest('button[disabled], [aria-disabled=true], input[disabled]')) continue;
    const cs = getComputedStyle(el);
    const fs = parseFloat(cs.fontSize);
    if (fs < 12.95) {
      const k = `small:${name(el)}`;
      if (!seen.has(k)) (seen.add(k), out.push(`мелкий текст ${fs}px: ${name(el)}`));
    }
    const fg = parse(cs.color);
    if (!fg) continue;
    const bg = bgOf(el);
    const blended = [0, 1, 2].map((i) => fg[i]! * fg[3]! + bg[i]! * (1 - fg[3]!));
    let op = 1;
    for (let e: Element | null = el; e; e = e.parentElement) op *= Number(getComputedStyle(e).opacity);
    const shown = [0, 1, 2].map((i) => blended[i]! * op + bg[i]! * (1 - op));
    const L1 = lum(shown);
    const L2 = lum(bg);
    const ratio = (Math.max(L1, L2) + 0.05) / (Math.min(L1, L2) + 0.05);
    const large = fs >= 24 || (fs >= 18.66 && Number(cs.fontWeight) >= 700);
    if (ratio < (large ? 3 : 4.5) - 0.01) {
      const k = `contrast:${name(el)}`;
      if (!seen.has(k)) (seen.add(k), out.push(`контраст ${ratio.toFixed(2)}: ${name(el)}`));
    }
  }
  return out;
}

const browser = await chromium.launch();
let total = 0;
const report: string[] = [];
for (const scheme of ['light', 'dark'] as const) {
  for (const [stateName, screens] of PLAN) {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, colorScheme: scheme });
    const page = await ctx.newPage();
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(`${BASE}/?today=${TODAY}`);
    await put(page, serializeState(STATES[stateName]!(), TODAY));
    for (const name of screens) {
      const hash = SCREENS.find(([s]) => s === name)?.[1];
      if (!hash) throw new Error(`нет адреса для «${name}»`);
      await page.goto(`${BASE}/?today=${TODAY}${hash}`);
      await page.reload();
      await page.waitForTimeout(350);
      if (name === 'income-result') {
        await page.locator('input[name=amount]').first().fill('180000');
        await page.locator('input[name=amount]').first().press('Enter');
        await page.waitForTimeout(700);
      }
      if (name === 'fc-whatif-result') {
        await page.locator('#fc-whatif-form input[name=title]').fill('Аренда');
        await page.locator('#fc-whatif-form input[name=amount]').fill('120000');
        await page.getByRole('button', { name: 'Добавить событие' }).click();
        await page.waitForTimeout(250);
        await page.getByRole('button', { name: 'Посчитать' }).click();
        await page.waitForTimeout(700);
      }
      const problems: string[] = [];
      // самопроверка: заведомо плохие элементы должны найтись (UI_CHECK_SELFTEST=1)
      if (process.env.UI_CHECK_SELFTEST)
        await page.evaluate(() => document.querySelector('main')?.insertAdjacentHTML('afterbegin', '<button style="width:20px;height:20px;min-height:0;min-width:0;padding:0">x</button><p style="font-size:10px;color:#bbb">I_work 0.0% NaN</p><input>'));
      const text = await page.evaluate(() => document.body.innerText);
      for (const [re, label] of FORBIDDEN) {
        const m = text.match(re);
        if (m) problems.push(`в тексте ${label}: «${text.slice(Math.max(0, m.index! - 20), m.index! + 25).replace(/\s+/g, ' ')}»`);
      }
      problems.push(...(await page.evaluate(inPage)));
      if (scheme === 'light' && stateName === 'broken' && TRUST_SCREENS.has(name)) {
        const chip = await page.locator('.trust').first();
        const cls = (await chip.getAttribute('class')) ?? '';
        const t = (await chip.textContent()) ?? '';
        if (!cls.includes('bad') || !t.includes('Kaspi Gold') || !t.includes('0,01')) problems.push(`метка доверия: «${t}» (${cls})`);
      }
      if (scheme === 'light' && stateName === 'configured' && name === 'overview') {
        const top = await page.locator('.hero').first().evaluate((e) => e.getBoundingClientRect().top + window.scrollY);
        if (top > 300) problems.push(`главная плашка начинается на ${Math.round(top)} px`);
      }
      if (errors.length) problems.push(...errors.splice(0).map((e) => `ошибка страницы: ${e}`));
      if (problems.length) {
        total += problems.length;
        report.push(`\n[${scheme}] ${stateName} / ${name}`, ...problems.map((p) => `  · ${p}`));
      }
    }
    await ctx.close();
  }
}
await browser.close();
console.log(report.join('\n') || '');
console.log(total ? `\nНарушений: ${total}` : 'Все проверки пройдены ✓');
process.exit(total ? 1 : 0);
