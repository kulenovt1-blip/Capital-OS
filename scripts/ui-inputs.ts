/**
 * Проверка вводов «Положения» в настоящем браузере (T16): bun scripts/ui-inputs.ts
 * Нужен запущенный сервер: PORT=5199 bun scripts/dev-server.ts &
 *
 *  A. «О тебе»: неверные значения не сохраняются и показывают ошибку; верные сохраняются, переживают перезагрузку
 *     и появляются в личном сценарии «При желаемых расходах»; очищенные поля убирают сценарий.
 *  B. Ручной актив «жильё / заблокировано»: растёт «Всего капитал», появляется строка «Из них можно снять за 30 дней»,
 *     один раз задаётся вопрос про кредит; «Нет» его закрывает; при повторном сохранении вопрос не возвращается.
 *  C. Ручной актив «деньги»: вопроса про кредит нет, оба числа растут на одну сумму.
 *  D. Заблокированные деньги: при сроке снятия дольше месяца предлагается «жильё / заблокировано».
 *  E. Ошибки формы актива: без названия и без суммы актив не добавляется.
 * Код выхода 1, если хоть одна проверка не прошла.
 */
// @ts-nocheck — служебный скрипт для Bun
import { chromium } from 'playwright';
import { serializeState } from '../engine/index';
import { BASE, TODAY, STATES, put } from './ui-states';

const URL = `${BASE}/?today=${TODAY}`;
let failed = 0;
const check = (name: string, ok: boolean, detail = '') => {
  console.log(`${ok ? '✓' : '✗'} ${name}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failed++;
};

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
const page = await ctx.newPage();
const pageErrors: string[] = [];
page.on('pageerror', (e) => pageErrors.push(e.message));

const open = async (hash: string) => {
  await page.goto(`${URL}${hash}`);
  await page.reload();
  await page.waitForTimeout(400);
};
const body = async () => (await page.evaluate(() => document.body.innerText)).replace(/[\u00a0\u202f]/g, ' ');
const digits = (s: string) => Number(s.replace(/[^\d−-]/g, '').replace('−', '-'));
/** Число из строки «Всего капитал … 1 980 000 ₸» на экране «Положение». */
const totalCapital = async () => {
  const m = (await body()).replace(/ /g, ' ').match(/Всего капитал[\s\S]*?(−?\d[\d ]*) ₸/);
  return m ? digits(m[1]!) : NaN;
};
const submit = async (form: string) => {
  await page.locator(`button[type=submit][form=${form}]`).click();
  await page.waitForTimeout(500);
};
const stateOnDisk = () =>
  page.evaluate(
    () =>
      new Promise((res) => {
        const r = indexedDB.open('capital-os', 1);
        r.onsuccess = () => {
          const q = r.result.transaction('kv').objectStore('kv').get('state');
          q.onsuccess = () => (r.result.close(), res(JSON.parse(q.result).state));
        };
      }),
  );

await page.goto(URL);
await put(page, serializeState(STATES.configured(), TODAY));

// ── A. «О тебе» ──
{
  await open('#/prefs~you');
  const age = page.locator('#you-form input[name=age]');
  const desired = page.locator('#you-form input[name=desired]');
  await age.fill('5');
  await submit('you-form');
  // возраст вне 14–100 останавливает сам браузер (min/max у поля): окно остаётся, ничего не сохраняется
  const blocked = await page.locator('#you-form').evaluate((f) => !f.checkValidity());
  check('A1. возраст 5 — форма не отправляется, окно не закрылось', blocked && (await page.locator('#you-form').count()) === 1);
  const disk1 = await stateOnDisk();
  check('A1. возраст 5 не сохранён', disk1.settings?.position?.age === undefined);

  await age.fill('');
  await desired.fill('0');
  await submit('you-form');
  const err2 = await page.locator('.error-box').first().textContent().catch(() => '');
  check('A2. нулевые траты — ошибка «сумма больше нуля»', /больше нуля/.test(err2 ?? ''), err2 ?? '');
  check('A2. ноль не сохранён', (await stateOnDisk()).settings?.position?.desiredMonthly === 30000000, JSON.stringify((await stateOnDisk()).settings?.position));
  await desired.fill('abc');
  check('A2. буквы в поле суммы не вводятся', (await desired.inputValue()) === '', await desired.inputValue());

  await age.fill('35');
  await desired.fill('250000');
  check('A3. сумма разбивается на разряды по мере ввода', (await desired.inputValue()).replace(/ /g, ' ') === '250 000', await desired.inputValue());
  await submit('you-form');
  check('A3. после сохранения окно закрыто', (await page.locator('#you-form').count()) === 0);
  const disk2 = await stateOnDisk();
  check('A3. возраст и желаемые траты на диске', disk2.settings?.position?.age === 35 && disk2.settings?.position?.desiredMonthly > 0, JSON.stringify(disk2.settings?.position));
  const prefs = await (async () => (await open('#/prefs'), await body()))();
  check('A3. в настройках строка «О тебе» показывает 35 лет и сумму', /35 лет/.test(prefs) && /250/.test(prefs));
  await open('#/position');
  const pos = (await body()).replace(/ /g, ' ');
  check('A3. после перезагрузки на «Положении» личный сценарий с 250 000', /при желаемых расходах \(гипотеза\)/i.test(pos) && pos.includes('250 000'));

  await open('#/prefs~you');
  await page.locator('#you-form input[name=age]').fill('');
  await page.locator('#you-form input[name=desired]').fill('');
  await submit('you-form');
  await open('#/position');
  const pos2 = await body();
  check('A4. очищенные поля убирают личный сценарий', !/при желаемых расходах/i.test(pos2));
  const disk3 = await stateOnDisk();
  check('A4. на диске нет пустых настроек положения', disk3.settings?.position === undefined, JSON.stringify(disk3.settings?.position));
}

// ── B. жильё: заблокировано на срок, вопрос про кредит ──
const readSpendable = async () => {
  const t = await body();
  const m = t.match(/Из них можно снять за 30 дней[\s\S]*?(−?\d[\d ]*) ₸/);
  return m ? digits(m[1]!) : null;
};
{
  await open('#/position');
  const before = await totalCapital();
  const spendBefore = (await readSpendable()) ?? before;
  await open('#/accounts~manual/new');
  await page.locator('#manual-form input[name=title]').fill('Квартира');
  await page.locator('#manual-form input[name=balance]').fill('30000000');
  await page.getByRole('radio', { name: 'После даты' }).click();
  await page.locator('#manual-form input[type=date]').nth(1).fill('2028-01-01');
  await page.locator('#manual-form input[type=date]').nth(1).dispatchEvent('change');
  await page.getByRole('radio', { name: 'Жильё / заблокировано' }).click();
  await submit('manual-form');
  const dialog = page.locator('[role=dialog]');
  check('B1. после добавления жилья спрашивают про кредит', (await dialog.count()) === 1 && /кредит или ипотека/i.test((await dialog.textContent()) ?? ''));
  await page.getByRole('button', { name: 'Нет', exact: true }).click();
  await page.waitForTimeout(300);
  check('B1. «Нет» закрывает вопрос', (await dialog.count()) === 0);
  await open('#/position');
  const after = await totalCapital();
  check('B2. «Всего капитал» вырос ровно на 30 млн', after - before === 30_000_000, `${before} → ${after}`);
  const spendAfter = await readSpendable();
  check('B2. появилась строка «Из них можно снять за 30 дней»', spendAfter !== null);
  check('B3. «Деньги, которые можно потратить» от жилья не выросли', spendAfter !== null && spendAfter <= spendBefore + 1, `${spendBefore} → ${spendAfter}`);

  // повторное сохранение того же жилья вопроса не возвращает (спрашиваем один раз)
  await open('#/rare/manual');
  await page.getByText('Квартира').first().click();
  await page.waitForTimeout(300);
  await submit('manual-form');
  check('B4. повторное сохранение — вопроса про кредит нет', (await page.locator('[role=dialog]').count()) === 0);
}

// ── B5. ОТКРЫТЫЙ ВОПРОС (не ошибка скрипта): «жильё / заблокировано» при сроке «Сразу» ──
// Форма оставляет срок «Сразу», если его не менять. Тогда актив лежит в «Всего капитал» и в «Деньги, которые можно потратить» одинаково,
// хотя в D138 жильё в «потратить» не входит (исключено только из независимости). Расчёт не менялся — записка владельцу.
{
  await open('#/position');
  const spendBefore = (await readSpendable()) ?? (await totalCapital());
  await open('#/accounts~manual/new');
  await page.locator('#manual-form input[name=title]').fill('Гараж');
  await page.locator('#manual-form input[name=balance]').fill('5000000');
  await page.getByRole('radio', { name: 'Жильё / заблокировано' }).click();
  await submit('manual-form');
  if ((await page.locator('[role=dialog]').count()) === 1) await page.getByRole('button', { name: 'Нет', exact: true }).click();
  await open('#/position');
  const spendAfter = (await readSpendable()) ?? (await totalCapital());
  console.log(spendAfter - spendBefore >= 5_000_000 ? `⚠ ОТКРЫТО: жильё со сроком «Сразу» вошло в «Деньги, которые можно потратить» (+${spendAfter - spendBefore} ₸)` : '✓ B5. жильё со сроком «Сразу» не входит в «потратить»');
}

// ── C. деньги: вопроса про кредит нет ──
{
  await open('#/position');
  const before = await totalCapital();
  await open('#/accounts~manual/new');
  await page.locator('#manual-form input[name=title]').fill('Депозит в другом банке');
  await page.locator('#manual-form input[name=balance]').fill('1000000');
  await submit('manual-form');
  check('C1. актив «деньги» — вопроса про кредит нет', (await page.locator('[role=dialog]').count()) === 0);
  await open('#/position');
  const after = await totalCapital();
  check('C2. «Всего капитал» вырос на 1 млн', after - before === 1_000_000, `${before} → ${after}`);
}

// ── D. срок снятия дольше месяца → предложение «жильё / заблокировано» ──
{
  await open('#/accounts~manual/new');
  await page.getByRole('radio', { name: 'После даты' }).click();
  await page.locator('#manual-form input[type=date]').nth(1).fill('2028-01-01');
  await page.locator('#manual-form input[type=date]').nth(1).dispatchEvent('change');
  await page.waitForTimeout(200);
  const t = await body();
  check('D1. при блокировке на годы предлагают «жильё / заблокировано»', /Это жильё или заблокированные деньги\?/.test(t));
  await page.getByRole('button', { name: 'Да, жильё / заблокировано' }).click();
  const on = await page.getByRole('radio', { name: 'Жильё / заблокировано' }).getAttribute('aria-checked');
  check('D2. «Да» переключает вид на «Жильё / заблокировано»', on === 'true');
}

// ── E. ошибки формы актива ──
{
  const countBefore = (await stateOnDisk()).manualAccounts.length;
  await open('#/accounts~manual/new');
  await page.locator('#manual-form input[name=balance]').fill('1000');
  await page.locator('#manual-form input[name=title]').evaluate((e) => e.removeAttribute('required'));
  await submit('manual-form');
  const e1 = (await page.locator('.error-box').first().textContent().catch(() => '')) ?? '';
  check('E1. без названия — «Нужно название»', /Нужно название/.test(e1), e1);
  await page.locator('#manual-form input[name=title]').fill('Тест');
  await page.locator('#manual-form input[name=balance]').fill('');
  await submit('manual-form');
  const e2 = (await page.locator('.error-box').first().textContent().catch(() => '')) ?? '';
  check('E2. без суммы — ошибка про тенге', /тенге/.test(e2), e2);
  check('E3. ничего не добавилось', (await stateOnDisk()).manualAccounts.length === countBefore);
}

check('Нет ошибок страницы', pageErrors.length === 0, pageErrors.join(' | '));
await browser.close();
console.log(failed ? `\nНе прошло проверок: ${failed}` : '\nВсе проверки пройдены ✓');
process.exit(failed ? 1 : 0);
