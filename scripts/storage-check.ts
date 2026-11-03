/**
 * Проверка защиты данных в настоящем браузере (D91): bun scripts/storage-check.ts
 * Нужен запущенный сервер: PORT=5199 bun scripts/dev-server.ts &
 *
 *  A. Запись в IndexedDB отклонена → нет сообщения об успехе, есть красная плашка и «Скачать копию».
 *  B. Сохранённые данные от более новой версии → экран восстановления, исходник не тронут и отложен копией;
 *     «Начать заново» работает только по явному выбору, копия остаётся.
 *  C. На экране восстановления можно восстановить бэкап из файла.
 *  E. Копию до переноса записать не удалось → перенос не начинается: красная плашка, запись заблокирована, исходник не тронут;
 *     «Повторить» после того, как место появилось, — копия сделана, запись снова разрешена (D103).
 *  D. Старое состояние (до D96) при первом открытии откладывается копией state.before-simple и не перезаписывается ею повторно.
 * Код выхода 1, если хоть одна проверка не прошла.
 */
// @ts-nocheck — служебный скрипт для Bun
import { chromium } from 'playwright';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { serializeState } from '../engine/index';
import { BASE, TODAY, STATES, put } from './ui-states';

const URL = `${BASE}/?today=${TODAY}`;
let failed = 0;
const check = (name: string, ok: boolean, detail = '') => {
  console.log(`${ok ? '✓' : '✗'} ${name}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failed++;
};
const idbKeys = (page) =>
  page.evaluate(() => new Promise((res) => {
    const r = indexedDB.open('capital-os', 1);
    r.onsuccess = () => {
      const q = r.result.transaction('kv').objectStore('kv').getAllKeys();
      q.onsuccess = () => (r.result.close(), res(q.result));
    };
  }));
const idbGet = (page, key) =>
  page.evaluate((k) => new Promise((res) => {
    const r = indexedDB.open('capital-os', 1);
    r.onsuccess = () => {
      const q = r.result.transaction('kv').objectStore('kv').get(k);
      q.onsuccess = () => (r.result.close(), res(q.result));
    };
  }), key);
const toastText = (page) => page.locator('#toast').textContent().catch(() => '');

const browser = await chromium.launch();

// ── A ──
{
  const page = await (await browser.newContext({ viewport: { width: 390, height: 844 } })).newPage();
  await page.goto(URL);
  await put(page, serializeState(STATES.imported(), TODAY));
  await page.goto(`${URL}#/prefs`);
  await page.reload();
  await page.waitForTimeout(500);
  await page.evaluate(() => {
    IDBObjectStore.prototype.put = function () {
      throw new DOMException('эмуляция', 'QuotaExceededError');
    };
  });
  await page.getByRole('switch', { name: 'Сразу показывать подробности' }).click();
  await page.waitForTimeout(400);
  const t = (await toastText(page)) ?? '';
  check('A: нет сообщения об успехе', !/Подробности открыты сразу/.test(t), t);
  check('A: сообщение о том, что не сохранено', /Не сохранено/.test(t));
  check('A: красная плашка над экраном', await page.locator('.storage-banner').isVisible());
  check('A: в плашке кнопка «Скачать копию»', await page.getByRole('button', { name: 'Скачать копию' }).isVisible());
  await page.context().close();
}

// ── B ──
let rawBefore = '';
{
  const page = await (await browser.newContext({ viewport: { width: 390, height: 844 } })).newPage();
  await page.goto(URL);
  const obj = JSON.parse(serializeState(STATES.configured(), TODAY));
  obj.version = 2;
  rawBefore = JSON.stringify(obj);
  await put(page, rawBefore);
  await page.goto(`${URL}#/goals`);
  await page.reload();
  await page.waitForTimeout(500);
  check('B: экран восстановления вместо приложения', await page.getByRole('heading', { name: 'Не удалось открыть твои данные' }).isVisible());
  check('B: нижней навигации нет (импорт поверх данных невозможен)', !(await page.locator('nav.bn').count()));
  check('B: исходник под ключом state не тронут', (await idbGet(page, 'state')) === rawBefore);
  const keys = await idbKeys(page);
  const copy = keys.find((k) => String(k).startsWith('state.unreadable.'));
  check('B: исходник отложен копией', !!copy && (await idbGet(page, copy)) === rawBefore, String(copy));
  await page.reload();
  await page.waitForTimeout(400);
  check('B: после перезагрузки всё ещё экран восстановления', await page.getByRole('heading', { name: 'Не удалось открыть твои данные' }).isVisible());
  check('B: исходник всё ещё не тронут', (await idbGet(page, 'state')) === rawBefore);
  check('B: повторное открытие не плодит копии', (await idbKeys(page)).filter((k) => String(k).startsWith('state.unreadable.')).length === 1);
  await page.getByRole('button', { name: 'Начать заново' }).click();
  await page.getByRole('button', { name: 'Начать заново' }).last().click();
  await page.waitForTimeout(500);
  check('B: «Начать заново» открывает приложение', await page.locator('nav.bn').isVisible());
  const keys2 = await idbKeys(page);
  check('B: копия нечитаемых данных осталась', keys2.some((k) => String(k).startsWith('state.unreadable.')));
  await page.context().close();
}

// ── C ──
{
  const page = await (await browser.newContext({ viewport: { width: 390, height: 844 } })).newPage();
  await page.goto(URL);
  await put(page, '{"app":"capital-os","version":1,"state":{');
  await page.reload();
  await page.waitForTimeout(500);
  const dir = mkdtempSync(join(tmpdir(), 'cos-'));
  const file = join(dir, 'backup.json');
  writeFileSync(file, serializeState(STATES.configured(), TODAY));
  await page.setInputFiles('.recovery input[type=file]', file);
  await page.waitForTimeout(600);
  check('C: бэкап восстановлен — приложение открылось', await page.locator('nav.bn').isVisible());
  const saved = JSON.parse(await idbGet(page, 'state'));
  check('C: в хранилище восстановленные цели', saved.state.goals.length === STATES.configured().goals.length, `целей ${saved.state.goals.length}`);
  await page.context().close();
}

// ── D ──
{
  const page = await (await browser.newContext({ viewport: { width: 390, height: 844 } })).newPage();
  await page.goto(URL);
  const obj = JSON.parse(serializeState(STATES.configured(), TODAY));
  delete obj.state.settings.simpleMigrated;
  const legacy = JSON.stringify(obj);
  await put(page, legacy);
  await page.goto(`${URL}#/goals`);
  await page.reload();
  await page.waitForTimeout(500);
  check('D: приложение открылось', await page.locator('nav.bn').isVisible());
  check('D: копия до переноса отложена', (await idbGet(page, 'state.before-simple')) === legacy);
  await page.getByRole('link', { name: '＋ Папка' }).click();
  await page.locator('#goal-new-form input[name=title]').fill('Проверка');
  await page.getByRole('button', { name: 'Создать папку' }).click();
  await page.waitForTimeout(500);
  const saved = JSON.parse(await idbGet(page, 'state'));
  check('D: после записи состояние перенесено', saved.state.settings.simpleMigrated === true);
  await page.reload();
  await page.waitForTimeout(400);
  check('D: копия не перезаписана перенесённым состоянием', (await idbGet(page, 'state.before-simple')) === legacy);
  await page.context().close();
}

// ── E ──
{
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  // запись копии падает, пока в окне не снят флаг
  await ctx.addInitScript(() => {
    const orig = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (v, k) {
      if (k === 'state.before-simple' && !(window as any).__allowCopy) throw new DOMException('эмуляция', 'QuotaExceededError');
      return orig.call(this, v, k);
    };
  });
  const page = await ctx.newPage();
  await page.goto(URL);
  const obj = JSON.parse(serializeState(STATES.configured(), TODAY));
  delete obj.state.settings.simpleMigrated;
  const legacy = JSON.stringify(obj);
  await put(page, legacy);
  await page.goto(`${URL}#/goals`);
  await page.reload();
  await page.waitForTimeout(500);
  check('E: красная плашка «не удалось сохранить копию»', await page.locator('.storage-banner').filter({ hasText: 'копию' }).isVisible());
  check('E: копии нет', (await idbGet(page, 'state.before-simple')) === undefined);
  await page.getByRole('link', { name: '＋ Папка' }).click();
  await page.locator('#goal-new-form input[name=title]').fill('Проверка');
  await page.getByRole('button', { name: 'Создать папку' }).click();
  await page.waitForTimeout(400);
  check('E: исходник не перезаписан', (await idbGet(page, 'state')) === legacy);
  await page.keyboard.press('Escape');
  await page.goto(`${URL}#/goals`);
  await page.waitForTimeout(300);
  await page.evaluate(() => ((window as any).__allowCopy = true));
  await page.getByRole('button', { name: 'Повторить' }).click();
  await page.waitForTimeout(400);
  check('E: «Повторить» сделал копию', (await idbGet(page, 'state.before-simple')) === legacy);
  check('E: плашка ушла', !(await page.locator('.storage-banner').count()));
  await ctx.close();
}

await browser.close();
console.log(failed ? `\nНе прошло: ${failed}` : '\nВсе проверки прошли');
process.exit(failed ? 1 : 0);
