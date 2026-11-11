/**
 * Проверка вводов «Положения» в настоящем браузере (T16): bun scripts/ui-inputs.ts
 * Нужен запущенный сервер: PORT=5199 bun scripts/dev-server.ts &
 *
 *  A. «О тебе»: неверные значения не сохраняются и показывают ошибку; верные сохраняются, переживают перезагрузку
 *     и появляются в личном сценарии «При желаемых расходах»; очищенные поля убирают сценарий.
 *  B. Ручной актив «жильё / заблокировано»: растёт «Всего капитал», появляется строка «Доступно в течение месяца»,
 *     один раз задаётся вопрос про кредит; «Нет» его закрывает; при повторном сохранении вопрос не возвращается.
 *  B5. Жильё со сроком «Сразу» не входит в «потратить», но входит в «Всего капитал» (D149).
 *  C. Ручной актив «деньги»: вопроса про кредит нет, оба числа растут на одну сумму.
 *  D. Заблокированные деньги: при сроке снятия дольше месяца предлагается «жильё / заблокировано».
 *  E. Ошибки формы актива: без названия и без суммы актив не добавляется.
 *  F. Переименование рассрочки в карточке платежа (D150): пустое название — ошибка, новое — сохраняется и видно в списке.
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
  const m = t.match(/Доступно в течение месяца[\s\S]*?(−?\d[\d ]*) ₸/);
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
  check('B2. появилась строка «Доступно в течение месяца»', spendAfter !== null);
  check('B3. «Доступно в течение месяца» от жилья не выросли', spendAfter !== null && spendAfter <= spendBefore + 1, `${spendBefore} → ${spendAfter}`);

  // повторное сохранение того же жилья вопроса не возвращает (спрашиваем один раз)
  await open('#/rare/manual');
  await page.getByText('Квартира').first().click();
  await page.waitForTimeout(300);
  await submit('manual-form');
  check('B4. повторное сохранение — вопроса про кредит нет', (await page.locator('[role=dialog]').count()) === 0);
}

// ── B5. жильё со сроком «Сразу» — не деньги (D149, решение владельца 10.11) ──
{
  await open('#/position');
  const spendBefore = (await readSpendable()) ?? (await totalCapital());
  const totalBefore = await totalCapital();
  await open('#/accounts~manual/new');
  await page.locator('#manual-form input[name=title]').fill('Гараж');
  await page.locator('#manual-form input[name=balance]').fill('5000000');
  await page.getByRole('radio', { name: 'Жильё / заблокировано' }).click();
  await submit('manual-form');
  if ((await page.locator('[role=dialog]').count()) === 1) await page.getByRole('button', { name: 'Нет', exact: true }).click();
  await open('#/position');
  const spendAfter = (await readSpendable()) ?? (await totalCapital());
  check('B5. жильё со сроком «Сразу» не вошло в «потратить»', spendAfter <= spendBefore + 1, `${spendBefore} → ${spendAfter}`);
  check('B5. но в «Всего капитал» вошло', (await totalCapital()) - totalBefore === 5_000_000);
  await open('#/overview');
  const ov = await body();
  check('B5. на «Обзоре» нет даты 9999', !/9999/.test(ov));
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

// ── F. переименование платежа ──
{
  const before = (await stateOnDisk()).obligations;
  const first = before[0];
  await open('#/debts');
  await page.locator('a[href*="~debt/"]').first().click();
  await page.waitForTimeout(400);
  const input = page.locator('#debt-edit-form input[name=title]');
  await input.fill('   ');
  await page.getByRole('button', { name: 'Сохранить' }).click();
  await page.waitForTimeout(300);
  check('F1. пустое название — ошибка, окно открыто', /Нужно название/.test((await page.locator('.error-box').first().textContent().catch(() => '')) ?? '') && (await input.count()) === 1);
  await input.fill('Мои духи');
  await page.getByRole('button', { name: 'Сохранить' }).click();
  await page.waitForTimeout(500);
  const after = (await stateOnDisk()).obligations.find((o) => o.id === first.id);
  check('F2. название сохранено, остальное то же', after?.title === 'Мои духи' && JSON.stringify({ ...after, title: first.title }) === JSON.stringify(first));
  await open('#/debts');
  check('F3. новое название видно в списке', /Мои духи/.test(await body()));
  // правка чисел: остаток и платёж пересчитывают график; id остаётся
  await page.locator('a[href*="~debt/"]').first().click();
  await page.waitForTimeout(400);
  await page.locator('#debt-edit-form input[name=payment]').fill('10 000');
  await page.locator('#debt-edit-form input[name=remaining]').fill('50 000');
  await page.getByRole('button', { name: 'Сохранить' }).click();
  await page.waitForTimeout(500);
  const rev = (await stateOnDisk()).obligations.find((o) => o.id === first.id);
  check('F4. остаток и платёж изменены, график пересчитан', rev?.remaining === 5_000_000 && rev.schedule.length === 5 && rev.schedule[0]?.amount === 1_000_000);
}

check('Нет ошибок страницы', pageErrors.length === 0, pageErrors.join(' | '));
await browser.close();
console.log(failed ? `\nНе прошло проверок: ${failed}` : '\nВсе проверки пройдены ✓');
process.exit(failed ? 1 : 0);
