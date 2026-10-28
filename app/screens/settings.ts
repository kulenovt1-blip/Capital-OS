/**
 * Подэкраны «Ещё» (D88): счета, доходы, долги и рассрочки, бэкап, установка, редкое, для продвинутых.
 * У каждого — короткий список строк; правка одного объекта — в окне поверх экрана. Блоков «Что это / Нужно ли тебе» нет:
 * пояснение — одна серая строка там, где оно реально помогает, остальное — в ⓘ.
 */
import {
  DEFAULT_CLASSIFICATION, INCOME_KIND_HINTS, INCOME_PATTERN_LABELS, accountsNeedingReview, classRegistry, createIncomeKind, deleteIncomeKind,
  emptyState, incomeKindDefaults, incomeKindPreview, incomeKindRegistry, kindBehavior, makeInstallment, makeRecurring, parseState, remainingFromLastDate, remainingFromTerm,
  serializeState, suggestionToObligation, tenge, updateIncomeKind, validateAdjustment, validateClassification, validateIncomeItem, validateObligation,
  type AccountSettings, type AppState, type CategoryRule, type IncomeKind, type IncomeKindDef, type IncomePattern, type InstallmentSuggestion, type Liquidity, type ManualAccount,
  type Obligation, type Overview, type RemainingResult, type StrategyId,
} from '../../engine/index';
import { ask, download, field, h, toast } from '../dom';
import { act, getState, replaceState, today, update } from '../store';
import { errorsBox, fmt, fmtDate, info, moneyInput, newId, nWord, readChecked, readMoney, readStr, row, rows, seg, stickyBar, sub, typeLabel } from '../ui';
import { closeSheet, defineSheet, sheetHref } from '../main';
import { installBlock } from '../install';
import { accountsReview, catName, incomeQuickForm } from '../blocks';
import { badAccounts, ov } from '../ctx';
import { scenarioWord } from './forecast';

const cap = (t: string) => t.replace(/^./, (c) => c.toUpperCase());
const gray = (text: string) => h('p', { class: 'muted' }, text);
const noData = () => h('div', { class: 'card stack' }, h('strong', null, 'Сначала загрузи бэкап'), h('a', { class: 'btn primary wide', href: '#/import' }, 'Загрузить бэкап'));

// ───────────────────────── когда можно снять ─────────────────────────

function liqLabel(l: Liquidity): string {
  if (l.kind === 'instant') return 'сразу';
  if (l.kind === 'days') return `через ${l.days} дн.`;
  return `после ${fmtDate(l.date)}`;
}

/** «Сразу / Через N дней / После даты» переключателем; поле — только для выбранного. */
function liquidityPicker(value: Liquidity, onChange: (l: Liquidity) => void): HTMLElement {
  let cur = value;
  const box = h('div', { class: 'stack' });
  const draw = () => {
    const days = h('input', { type: 'number', min: 0, step: 1, inputmode: 'numeric', value: cur.kind === 'days' ? cur.days : 30, 'aria-label': 'Через сколько дней' });
    const date = h('input', { type: 'date', value: cur.kind === 'locked_until' ? cur.date : today(), 'aria-label': 'После какой даты' });
    days.addEventListener('change', () => onChange((cur = { kind: 'days', days: Math.max(0, Math.floor(Number(days.value) || 0)) })));
    date.addEventListener('change', () => onChange((cur = { kind: 'locked_until', date: date.value || today() })));
    box.replaceChildren(
      ...([seg([['instant', 'Сразу'], ['days', 'Через N дней'], ['locked_until', 'После даты']] as const, cur.kind, (k) => {
        cur = k === 'instant' ? { kind: 'instant' } : k === 'days' ? { kind: 'days', days: cur.kind === 'days' ? cur.days : 30 } : { kind: 'locked_until', date: cur.kind === 'locked_until' ? cur.date : today() };
        onChange(cur);
        draw();
      }, 'Когда можно снять'),
      cur.kind === 'days' ? field('Сколько дней', days) : null,
      cur.kind === 'locked_until' ? field('С какой даты', date) : null,
      ].filter(Boolean) as Node[]),
    );
  };
  draw();
  return box;
}

// ───────────────────────── счета ─────────────────────────

function accountSettings(st: AppState, id: string): AccountSettings {
  return st.settings.accounts.find((s) => s.accountId === id) ?? { accountId: id, excluded: false, liquidity: { kind: 'instant' } };
}

function patchAccount(id: string, patch: (a: AccountSettings) => AccountSettings, msg: string): Promise<void> {
  return act((s) => {
    const next = { ...patch(accountSettings(s, id)), reviewed: true };
    return { ...s, settings: { ...s.settings, accounts: [...s.settings.accounts.filter((x) => x.accountId !== id), next].sort((x, y) => (x.accountId < y.accountId ? -1 : 1)) } };
  }, msg);
}

export function renderAccounts(section?: string): HTMLElement {
  const st = getState();
  const root = h('div', { class: 'screen' });
  if (!st.imported) return (root.append(noData()), root);
  if (section === 'savings') return (root.append(savingsBlock(st)), root);
  const o = ov();
  const bad = badAccounts();
  const goals = new Map(st.goals.map((g) => [g.id, g.title]));
  const need = accountsNeedingReview(st.settings.accounts, st.imported.accounts);
  if (need.length) root.append(sub('Что это за счета?'), accountsReview());
  root.append(
    sub('Счета', info('liquid')),
    rows(
      o.capital.accounts.map((p) => {
        const s = accountSettings(st, p.accountId);
        const status = need.some((a) => a.id === p.accountId)
          ? 'ждёт ответа'
          : p.excluded
            ? 'не учитывается'
            : s.boundGoalId && goals.has(s.boundGoalId)
              ? `весь остаток за «${goals.get(s.boundGoalId)}»`
              : `снять: ${liqLabel(s.liquidity)}`;
        return row({
          title: p.title,
          sub: `${status}${p.source === 'savings_flow' ? ' · оценка' : ''}${p.source === 'manual' ? ' · ручной' : ''}`,
          value: h('span', { class: p.excluded ? 'muted' : '' }, fmt(p.balance)),
          href: p.source === 'manual' ? '#/rare/manual' : sheetHref('account', p.accountId),
          mark: bad.has(p.accountId),
        });
      }),
    ),
  );
  const hasSavings = o.capital.accounts.some((p) => p.source === 'savings_flow') || st.settings.savingsFlows.mode !== 'estimate';
  root.append(
    rows(
      hasSavings ? row({ title: 'Сбережения вне MoneyManager', sub: { estimate: 'считаются по сумме переводов', manual: 'прибавляются к ручному счёту', ignore: 'уже в балансах счетов' }[st.settings.savingsFlows.mode], href: '#/accounts/savings' }) : null,
      row({ title: 'Ручные счета', sub: 'депозит в другом банке, деньги у родителей', value: st.manualAccounts.length ? String(st.manualAccounts.length) : undefined, href: '#/rare/manual' }),
    ),
  );
  return root;
}

defineSheet('account', (id) => {
  const st = getState();
  const p = ov().capital.accounts.find((x) => x.accountId === id);
  if (!p) return null;
  const s = accountSettings(st, id);
  const goals = st.goals.filter((g) => g.status !== 'cancelled' && g.status !== 'done');
  const goalSel = h('select', { 'aria-label': 'Весь остаток за целью' }, h('option', { value: '' }, 'нет'), goals.map((g) => h('option', { value: g.id, selected: g.id === s.boundGoalId }, g.title)));
  goalSel.addEventListener('change', () => {
    const v = goalSel.value;
    void patchAccount(id, (a) => {
      const { boundGoalId: _old, ...rest } = a;
      return v ? { ...rest, boundGoalId: v } : rest;
    }, v ? `Весь остаток «${p.title}» — за «${goals.find((g) => g.id === v)?.title}»` : `«${p.title}» отвязан от цели`);
  });
  return {
    title: p.title,
    body: h(
      'div',
      { class: 'stack' },
      h('div', { class: 'card' }, h('strong', null, fmt(p.balance)), p.source === 'savings_flow' ? h('div', { class: 'muted' }, 'оценка по сумме переводов', info('savingsFlow')) : null),
      sub('Учитывать'),
      seg([['yes', 'Учитывать'], ['no', 'Не учитывать']] as const, s.excluded ? 'no' : 'yes', (v) => void patchAccount(id, (a) => ({ ...a, excluded: v === 'no' }), v === 'no' ? `«${p.title}» не учитывается` : `«${p.title}» учитывается`), 'Учитывать счёт'),
      gray('«Не учитывать» — только для технических счетов. Заначку не отключай: лучше закрепи её за целью.'),
      sub('Когда можно снять', info('liquid')),
      liquidityPicker(s.liquidity, (l) => void patchAccount(id, (a) => ({ ...a, liquidity: l }), `«${p.title}»: снять ${liqLabel(l)}`)),
      sub('Весь остаток за целью', info('assigned')),
      field('Цель', goalSel, 'остаток счёта будет за целью и при пополнении тоже'),
    ),
  };
});

/** Куда уходили переводы на сбережения вне MoneyManager. */
function savingsBlock(st: AppState): HTMLElement {
  const sf = st.settings.savingsFlows;
  const est = ov().capital.accounts.find((p) => p.source === 'savings_flow');
  const pick = (mode: 'estimate' | 'manual' | 'ignore', label: string) =>
    act((s) => {
      if (mode === 'manual') {
        const id = s.settings.savingsFlows.mode === 'manual' ? s.settings.savingsFlows.manualAccountId : s.manualAccounts[0]?.id;
        if (!id) return s;
        return { ...s, settings: { ...s.settings, savingsFlows: { mode: 'manual', manualAccountId: id, confirmed: true } } };
      }
      return { ...s, settings: { ...s.settings, savingsFlows: { mode, confirmed: true } } };
    }, label);
  const on = (m: string) => sf.mode === m;
  const manualSel = st.manualAccounts.length
    ? h('select', { 'aria-label': 'Ручной счёт' }, st.manualAccounts.map((m) => h('option', { value: m.id, selected: sf.mode === 'manual' && sf.manualAccountId === m.id }, m.title)))
    : null;
  manualSel?.addEventListener('change', () => void act((s) => ({ ...s, settings: { ...s.settings, savingsFlows: { mode: 'manual', manualAccountId: manualSel.value, confirmed: true } } }), 'Сбережения прибавляются к ручному счёту'));
  return h(
    'div',
    { class: 'stack' },
    gray(`Часть трат размечена как перевод на сбережения вне MoneyManager${est ? ` — всего ${fmt(est.balance)}` : ''}. Где эти деньги сейчас?`),
    rows(
      row({ title: 'Лежат на счёте, которого нет в MoneyManager', sub: 'считать по сумме переводов (без процентов)', value: on('estimate') ? '✓' : undefined, cls: on('estimate') ? 'on' : '', chevron: false, onClick: () => void pick('estimate', 'Сбережения считаются по сумме переводов') }),
      row({ title: 'Есть ручной счёт с настоящим остатком', sub: st.manualAccounts.length ? 'переводы после даты остатка прибавятся к нему' : 'сначала заведи ручной счёт в «Редком»', value: on('manual') ? '✓' : undefined, cls: on('manual') ? 'on' : '', chevron: false, onClick: () => (st.manualAccounts.length ? void pick('manual', 'Сбережения прибавляются к ручному счёту') : (location.hash = '#/rare/manual')) }),
      row({ title: 'Вернулись в MoneyManager', sub: 'например, счётом с начальным остатком — не считать второй раз', value: on('ignore') ? '✓' : undefined, cls: on('ignore') ? 'on' : '', chevron: false, onClick: () => void pick('ignore', 'Сбережения уже в балансах счетов') }),
    ),
    on('manual') && manualSel ? field('Какой ручной счёт', manualSel) : null,
    gray('Какие траты сюда попадают, решает тип «Перевод на сбережения вне приложения» в «Разметке».'),
  );
}

// ───────────────────────── доходы ─────────────────────────

function kindSummary(k: IncomeKindDef, st: AppState): string {
  const adv = st.settings.scenarios.find((x) => x.id === 'adverse')?.patch ?? {};
  const b = kindBehavior(adv, k.id);
  return [k.dependsOnWork ? 'зависит от работы' : 'от работы не зависит', INCOME_PATTERN_LABELS[k.pattern], `в «Хуже» ${b.factorBp / 100} %${b.delayMonths ? `, позже на ${b.delayMonths} мес.` : ''}`, k.ends ? 'заканчивается' : '']
    .filter(Boolean)
    .join(' · ');
}

export function renderIncomes(): HTMLElement {
  const st = getState();
  const reg = incomeKindRegistry(st.settings.incomeKinds);
  const root = h('div', { class: 'screen' });
  const list = st.settings.incomeSchedule;
  root.append(
    h('div', { class: 'goals-sum' }, h('div', { class: 'gs-text' }, list.length ? h('span', null, 'В месяц ', h('strong', null, fmt(list.reduce((a, x) => a + x.amount, 0) as never))) : h('span', null, 'Доходы не заданы')), h('a', { class: 'btn primary', href: sheetHref('income-new') }, '＋ Доход')),
  );
  if (!list.length) root.append(gray(`Без доходов «Свободно» считает на ${st.settings.defaultIncomeHorizonDays} дней вперёд, а прогноз идёт без поступлений.`));
  else
    root.append(
      rows(
        list.map((x) =>
          row({
            title: x.title,
            sub: `${x.dayOfMonth}-го · ${reg.find((k) => k.id === (x.kind ?? 'stable'))?.label ?? ''}${x.start ? ` · с ${fmtDate(x.start)}` : ''}${x.end ? ` · до ${fmtDate(x.end)}` : ''}`,
            value: fmt(x.amount),
            href: sheetHref('income-item', x.id),
          }),
        ),
      ),
    );
  root.append(rows(row({ title: 'Виды дохода', sub: 'как доход ведёт себя в сценарии «Хуже»', value: String(reg.length), href: sheetHref('income-kinds') })));
  return root;
}

defineSheet('income-new', () => ({ title: 'Новый доход', body: incomeQuickForm(() => closeSheet()) }));

defineSheet('income-item', (id) => {
  const st = getState();
  const x = st.settings.incomeSchedule.find((i) => i.id === id);
  if (!x) return null;
  const reg = incomeKindRegistry(st.settings.incomeKinds);
  const err = h('div');
  const kindSel = h('select', { name: 'kind' }, reg.map((k) => h('option', { value: k.id, selected: k.id === (x.kind ?? 'stable') }, k.label)));
  const kindHint = h('small', { class: 'hint' });
  const hintOf = (kid: string) => {
    const k = reg.find((y) => y.id === kid);
    return !k ? '' : k.builtin ? INCOME_KIND_HINTS[k.id as 'work' | 'stable' | 'irregular'] : kindSummary(k, st);
  };
  kindHint.textContent = hintOf(kindSel.value);
  kindSel.addEventListener('change', () => (kindHint.textContent = hintOf(kindSel.value)));
  const form = h(
    'form',
    { class: 'stack', id: 'income-item-form' },
    field('Откуда', h('input', { name: 'title', value: x.title, required: true, autocomplete: 'off' })),
    h('div', { class: 'grid-form' }, field('Какого числа', h('input', { name: 'day', type: 'number', min: 1, max: 31, inputmode: 'numeric', value: x.dayOfMonth })), field('Сколько в месяц, ₸', moneyInput('amount', x.amount))),
    h('label', { class: 'field' }, h('span', { class: 'field-label' }, 'Вид', info('incomeKind')), kindSel, kindHint),
    h('div', { class: 'grid-form' }, field('С даты', h('input', { name: 'start', type: 'date', value: x.start ?? '' })), field('По дату', h('input', { name: 'end', type: 'date', value: x.end ?? '' }))),
    err,
  );
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const amount = readMoney(form, 'amount');
    const day = Math.floor(Number(readStr(form, 'day')));
    const errs: string[] = [];
    if (!readStr(form, 'title')) errs.push('Напиши, откуда доход');
    if (!(day >= 1 && day <= 31)) errs.push('Число месяца — от 1 до 31');
    if (amount === null || amount <= 0) errs.push('Сумма должна быть больше нуля');
    const start = readStr(form, 'start');
    const end = readStr(form, 'end');
    const { start: _s, end: _e, ...base } = x;
    const item = { ...base, title: readStr(form, 'title'), dayOfMonth: day, amount: amount ?? (0 as never), kind: readStr(form, 'kind') as IncomeKind, ...(start ? { start } : {}), ...(end ? { end } : {}) };
    if (!errs.length) errs.push(...validateIncomeItem(item, reg));
    err.replaceChildren(errorsBox(errs) ?? '');
    if (errs.length) return;
    closeSheet();
    await act((s) => ({ ...s, settings: { ...s.settings, incomeSchedule: s.settings.incomeSchedule.map((y) => (y.id === id ? item : y)) } }), `«${item.title}» сохранён`);
  });
  const remove = async () => {
    const i = await ask({ title: `Удалить доход «${x.title}»?`, actions: [{ label: 'Удалить', kind: 'danger' }] });
    if (i !== 0) return;
    closeSheet();
    await act((s) => ({ ...s, settings: { ...s.settings, incomeSchedule: s.settings.incomeSchedule.filter((y) => y.id !== id) } }), `Доход «${x.title}» удалён`);
  };
  return {
    title: x.title,
    body: h('div', { class: 'stack' }, form, h('button', { class: 'btn danger wide', type: 'button', onclick: remove }, 'Удалить доход')),
    bar: stickyBar(null, h('button', { class: 'btn primary', type: 'submit', form: 'income-item-form' }, 'Сохранить')),
  };
});

defineSheet('income-kinds', () => {
  const st = getState();
  const reg = incomeKindRegistry(st.settings.incomeKinds);
  return {
    title: 'Виды дохода',
    body: h(
      'div',
      { class: 'stack' },
      gray('Вид решает, как доход ведёт себя в прогнозе: пропадёт ли вместе с работой, насколько упадёт в сценарии «Хуже», закончится ли.'),
      rows(reg.map((k) => row({ title: k.builtin ? cap(k.label) : h('span', null, cap(k.label), ' ', h('span', { class: 'tag' }, 'свой')), sub: kindSummary(k, st), href: sheetHref('income-kind', k.id) }))),
      h('a', { class: 'btn wide', href: sheetHref('income-kind-new') }, '＋ Новый вид дохода'),
    ),
  };
});

defineSheet('income-kind', (id) => {
  const st = getState();
  const k = incomeKindRegistry(st.settings.incomeKinds).find((x) => x.id === id);
  if (!k) return null;
  const adv = kindBehavior(st.settings.scenarios.find((x) => x.id === 'adverse')?.patch ?? {}, k.id);
  const err = h('div');
  const f = h(
    'form',
    { class: 'stack', id: 'income-kind-form' },
    !k.builtin ? field('Название', h('input', { name: 'label', value: k.label, autocomplete: 'off' })) : null,
    !k.builtin ? field('Пропадёт вместе с работой?', h('select', { name: 'work' }, h('option', { value: '1', selected: k.dependsOnWork }, 'да'), h('option', { value: '0', selected: !k.dependsOnWork }, 'нет'))) : null,
    !k.builtin ? field('Как приходит', h('select', { name: 'pattern' }, (Object.keys(INCOME_PATTERN_LABELS) as IncomePattern[]).map((p) => h('option', { value: p, selected: p === k.pattern }, INCOME_PATTERN_LABELS[p])))) : null,
    field('В сценарии «Хуже» остаётся, %', h('input', { name: 'factor', inputmode: 'decimal', value: String(adv.factorBp / 100) })),
    field('Если ещё не начался — начнётся позже на, мес.', h('input', { name: 'delay', type: 'number', min: 0, max: 24, inputmode: 'numeric', value: adv.delayMonths })),
    !k.builtin ? h('label', { class: 'check' }, h('input', { type: 'checkbox', name: 'ends', checked: k.ends }), ' Закончится (у дохода будет дата окончания)') : null,
    err,
  );
  f.addEventListener('submit', async (e) => {
    e.preventDefault();
    const factor = Math.round(Number(readStr(f, 'factor').replace(',', '.')) * 100);
    const patch = {
      adverseFactorBp: Number.isFinite(factor) ? factor : -1,
      delayMonths: Math.floor(Number(readStr(f, 'delay')) || 0),
      ...(!k.builtin ? { label: readStr(f, 'label'), dependsOnWork: readStr(f, 'work') === '1', pattern: readStr(f, 'pattern') as IncomePattern, ends: readChecked(f, 'ends') } : {}),
    };
    const r = updateIncomeKind(k.id, patch, getState().settings);
    if (!r.ok) return err.replaceChildren(errorsBox([r.error]) ?? '');
    closeSheet();
    await act((s) => ({ ...s, settings: r.value }), 'Вид сохранён');
  });
  const del = k.builtin ? null : deleteIncomeKind(k.id, st.settings);
  return {
    title: cap(k.label),
    body: h(
      'div',
      { class: 'stack' },
      gray(kindSummary(k, st)),
      f,
      del
        ? del.ok
          ? h('button', {
              class: 'btn danger wide',
              type: 'button',
              onclick: async () => {
                if ((await ask({ title: `Удалить вид «${k.label}»?`, actions: [{ label: 'Удалить', kind: 'danger' }] })) !== 0) return;
                const r = deleteIncomeKind(k.id, getState().settings);
                if (!r.ok) return toast(r.error, 'error');
                closeSheet();
                await act((s) => ({ ...s, settings: r.value }), 'Вид удалён');
              },
            }, 'Удалить вид')
          : gray(del.error)
        : null,
    ),
    bar: stickyBar(null, h('button', { class: 'btn primary', type: 'submit', form: 'income-kind-form' }, 'Сохранить')),
  };
});

defineSheet('income-kind-new', () => {
  const st = getState();
  const adverse = st.settings.scenarios.find((x) => x.id === 'adverse')?.patch ?? {};
  const label = h('input', { name: 'label', placeholder: 'Фриланс, аренда квартиры, помощь родителей…', autocomplete: 'off' });
  const work = h('select', { name: 'work' }, h('option', { value: '0' }, 'нет, от работы не зависит'), h('option', { value: '1' }, 'да, пропадёт вместе с работой'));
  const pattern = h('select', { name: 'pattern' }, (Object.keys(INCOME_PATTERN_LABELS) as IncomePattern[]).map((p) => h('option', { value: p }, INCOME_PATTERN_LABELS[p])));
  const factor = h('input', { name: 'factor', inputmode: 'decimal' });
  const delay = h('input', { name: 'delay', type: 'number', min: 0, max: 24, inputmode: 'numeric' });
  const ends = h('input', { type: 'checkbox', name: 'ends' });
  const preview = h('ul', { class: 'plain preview' });
  const err = h('div');
  let touched = false;
  const answers = () => ({ dependsOnWork: work.value === '1', pattern: pattern.value as IncomePattern, adverseFactorBp: Math.round(Number(factor.value.replace(',', '.')) * 100), delayMonths: Math.floor(Number(delay.value) || 0), ends: ends.checked });
  const applyDefaults = () => {
    if (touched) return;
    const d = incomeKindDefaults({ dependsOnWork: work.value === '1', pattern: pattern.value as IncomePattern }, adverse);
    factor.value = String(d.adverseFactorBp / 100);
    delay.value = String(d.delayMonths);
  };
  const form = h(
    'form',
    { class: 'stack', id: 'income-kind-new-form' },
    field('Название', label),
    field('Пропадёт ли он, если потеряешь основную работу?', work),
    field('Как он приходит?', pattern),
    field('Сколько остаётся в сценарии «Хуже», %', factor, 'подставлено по ответам выше — можно поменять'),
    field('Если доход ещё не начался — на сколько месяцев может задержаться?', delay),
    h('label', { class: 'check' }, ends, ' Он закончится (у дохода будет дата окончания)'),
    h('div', { class: 'card' }, h('strong', null, 'Что это значит в расчётах (на примере 40 000 ₸)'), preview),
    err,
  );
  const sync = () => preview.replaceChildren(...incomeKindPreview(answers(), tenge(40_000)).map((t) => h('li', null, t)));
  work.addEventListener('change', () => (applyDefaults(), sync()));
  pattern.addEventListener('change', () => (applyDefaults(), sync()));
  factor.addEventListener('input', () => ((touched = true), sync()));
  delay.addEventListener('input', () => ((touched = true), sync()));
  form.addEventListener('change', sync);
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const r = createIncomeKind({ label: label.value, ...answers() }, getState().settings);
    if (!r.ok) return err.replaceChildren(errorsBox([r.error]) ?? '');
    closeSheet();
    await act((s) => ({ ...s, settings: r.value }), `Вид «${label.value.trim()}» создан — выбери его у дохода`);
  });
  applyDefaults();
  sync();
  return { title: 'Новый вид дохода', body: form, bar: stickyBar(null, h('button', { class: 'btn primary', type: 'submit', form: 'income-kind-new-form' }, 'Создать вид')) };
});

// ───────────────────────── долги и рассрочки ─────────────────────────

const OB_KIND: Record<Obligation['kind'], string> = { installment: 'рассрочка', debt: 'долг', recurring: 'регулярный платёж' };

export function renderDebts(): HTMLElement {
  const st = getState();
  const o = ov();
  const root = h('div', { class: 'screen' });
  root.append(
    h('div', { class: 'goals-sum' }, h('div', { class: 'gs-text' }, st.obligations.length ? h('span', null, 'Осталось выплатить ', h('strong', null, fmt(o.capital.liabilities.total))) : h('span', null, 'Ничего не заведено')), h('a', { class: 'btn primary', href: sheetHref('debt-new') }, '＋ Добавить')),
  );
  const s = suggestionsBlock(st, o);
  if (s) root.append(s);
  const c = checksBlock(st, o);
  if (c) root.append(c);
  if (st.obligations.length) {
    root.append(
      sub('Заведено'),
      rows(
        st.obligations.map((ob) => {
          const status = o.obligations.find((x) => x.obligation.id === ob.id);
          const next = status?.effectiveUpcoming[0];
          return row({
            title: `${ob.title}${ob.owner === 'family' ? ' · семья' : ''}`,
            sub: [OB_KIND[ob.kind], next ? `следующий ${fmtDate(next.date)} · ${fmt(next.amount)}` : 'платежей больше нет'].join(' · '),
            value: ob.kind === 'recurring' ? undefined : fmt(status?.remainingNow ?? ob.remaining),
            href: sheetHref('debt', ob.id),
          });
        }),
      ),
    );
  }
  if (!s && !st.obligations.length) root.append(gray('Рассрочки из операций приложение находит само. Вручную — долги, которых нет в MoneyManager, и регулярные платежи.'));
  return root;
}

defineSheet('debt', (id) => {
  const st = getState();
  const ob = st.obligations.find((x) => x.id === id);
  if (!ob) return null;
  const status = ov().obligations.find((x) => x.obligation.id === id);
  const remove = async () => {
    if ((await ask({ title: `Удалить «${ob.title}»?`, text: 'Платежи по ней перестанут учитываться в «Свободно» и прогнозе.', actions: [{ label: 'Удалить', kind: 'danger' }] })) !== 0) return;
    closeSheet();
    await act((s) => ({ ...s, obligations: s.obligations.filter((x) => x.id !== id) }), `«${ob.title}» удалена`);
  };
  const up = status?.effectiveUpcoming ?? [];
  return {
    title: ob.title,
    body: h(
      'div',
      { class: 'stack' },
      rows(
        row({ title: 'Что это', value: `${OB_KIND[ob.kind]}${ob.owner === 'family' ? ', семейная' : ''}` }),
        ob.kind !== 'recurring' ? row({ title: 'Осталось', value: fmt(status?.remainingNow ?? ob.remaining) }) : null,
        row({ title: 'Платёж', value: ob.schedule[0] ? fmt(ob.schedule[0].amount) : '—' }),
        row({ title: 'Платежей впереди', value: String(up.length) }),
        up.length ? row({ title: 'Последний', value: fmtDate(up[up.length - 1]!.date) }) : null,
        ob.match?.tags?.length ? row({ title: 'Тег в MoneyManager', value: ob.match.tags.join(', ') }) : null,
      ),
      h('button', { class: 'btn danger wide', type: 'button', onclick: remove }, 'Удалить'),
    ),
  };
});

defineSheet('debt-new', () => {
  const st = getState();
  const tagNames = (st.imported?.tags ?? []).map((t) => t.name);
  const kind = h('select', { name: 'kind' }, h('option', { value: 'installment' }, 'Рассрочка'), h('option', { value: 'debt' }, 'Долг (нет в MoneyManager)'), h('option', { value: 'recurring' }, 'Регулярный платёж'));
  const remField = h('div', { class: 'grid-form' }, field('Осталось выплатить, ₸', moneyInput('remaining')), field('На дату', h('input', { name: 'asOf', type: 'date', value: today() })));
  const monthsField = field('Сколько месяцев', h('input', { name: 'months', type: 'number', min: 1, value: 12, inputmode: 'numeric' }));
  const sync = () => {
    remField.hidden = kind.value === 'recurring';
    monthsField.hidden = kind.value !== 'recurring';
  };
  kind.addEventListener('change', sync);
  const err = h('div');
  const form = h(
    'form',
    { class: 'stack', id: 'debt-new-form' },
    field('Что это', kind),
    field('Название', h('input', { name: 'title', required: true, placeholder: 'Рассрочка за телефон', autocomplete: 'off' })),
    remField,
    h('div', { class: 'grid-form' }, field('Платёж, ₸', moneyInput('payment')), field('Ближайший платёж', h('input', { name: 'first', type: 'date', value: today() }))),
    monthsField,
    h(
      'details',
      { class: 'fold', 'data-key': 'debt-new:more' },
      h('summary', null, 'Подробнее · чья, как найти платежи'),
      h(
        'div',
        { class: 'stack' },
        field('Чья', h('select', { name: 'owner' }, h('option', { value: 'self' }, 'моя'), h('option', { value: 'family' }, 'семейная'))),
        field('Платежи в MoneyManager с тегом', h('input', { name: 'tag', list: 'tag-list', placeholder: 'например, телефон', autocomplete: 'off' }), 'по нему платежи находятся сами'),
        field('…или с текстом в комментарии', h('input', { name: 'comment', autocomplete: 'off' })),
        h('datalist', { id: 'tag-list' }, tagNames.map((t) => h('option', { value: t }))),
      ),
    ),
    err,
  );
  sync();
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const k = readStr(form, 'kind') as Obligation['kind'];
    const payment = readMoney(form, 'payment');
    const remaining = readMoney(form, 'remaining');
    const tag = readStr(form, 'tag');
    const comment = readStr(form, 'comment');
    const match = tag || comment ? { ...(tag ? { tags: [tag] } : {}), ...(comment ? { commentContains: comment } : {}) } : undefined;
    const errs: string[] = [];
    if (!readStr(form, 'title')) errs.push('Нужно название');
    if (payment === null || payment <= 0) errs.push('Платёж должен быть больше нуля');
    if (k !== 'recurring' && (remaining === null || remaining <= 0)) errs.push('Укажи, сколько осталось выплатить');
    let ob: Obligation | null = null;
    if (!errs.length) {
      try {
        const base = { id: newId('ob'), title: readStr(form, 'title'), owner: readStr(form, 'owner') as 'self' | 'family', firstDate: readStr(form, 'first') || today(), ...(match ? { match } : {}) };
        ob = k === 'recurring' ? makeRecurring({ ...base, amount: payment!, months: Math.max(1, Math.floor(Number(readStr(form, 'months')) || 1)) }) : makeInstallment({ ...base, kind: k, remaining: remaining!, remainingAsOf: readStr(form, 'asOf') || today(), payment: payment! });
        errs.push(...validateObligation(ob));
      } catch (er) {
        errs.push(er instanceof Error ? er.message : String(er));
      }
    }
    err.replaceChildren(errorsBox(errs) ?? '');
    if (errs.length || !ob) return;
    const created = ob;
    closeSheet();
    await act((s) => ({ ...s, obligations: [...s.obligations, created] }), `«${created.title}» добавлена`);
  });
  return { title: 'Добавить вручную', body: form, bar: stickyBar(null, h('button', { class: 'btn primary', type: 'submit', form: 'debt-new-form' }, 'Добавить')) };
});

/** Находки автозаполнения: карточка на каждую рассрочку из операций (D67). */
export function suggestionsBlock(st: AppState, o: Overview): HTMLElement | null {
  const list = o.installments.suggestions;
  if (!list.length) return null;
  return h('div', { class: 'stack suggest-list' }, sub(`Найдено в операциях: ${list.length}`, info('installmentDetect')), ...list.map((s) => suggestionCard(st, s)));
}

function suggestionCard(st: AppState, s: InstallmentSuggestion): HTMLElement {
  type Method = 'term' | 'remaining' | 'last';
  let method: Method = s.uniform ? 'term' : 'remaining';
  const term = h('input', { name: 'term', type: 'number', min: 1, max: 120, placeholder: '12', inputmode: 'numeric' });
  const paid = h('input', { name: 'paid', type: 'number', min: 0, value: s.count, inputmode: 'numeric' });
  const remaining = moneyInput('remaining');
  const last = h('input', { name: 'last', type: 'date' });
  const title = h('input', { name: 'title', value: s.title, autocomplete: 'off' });
  const owner = h('select', { name: 'owner' }, h('option', { value: 'self', selected: s.owner === 'self' }, 'моя'), h('option', { value: 'family', selected: s.owner === 'family' }, 'семейная'));
  const fTerm = h('div', { class: 'grid-form' }, field('Рассрочка на, мес.', term), field('Сделано платежей', paid, s.mayPredateData ? 'если началась раньше бэкапа — укажи настоящее число' : undefined));
  const fRem = field('Осталось выплатить, ₸', remaining, 'например, из приложения банка');
  const fLast = field('Последний платёж', last);
  const preview = h('p', { class: 'muted' });
  const err = h('div');
  const compute = (): RemainingResult | null => {
    if (method === 'term') return term.value ? remainingFromTerm(s, Math.floor(Number(term.value)), Math.max(0, Math.floor(Number(paid.value) || 0))) : null;
    if (method === 'last') return last.value ? remainingFromLastDate(s, last.value) : null;
    const r = readMoney(form, 'remaining');
    return r === null ? null : r > 0 ? { ok: true, remaining: r, paymentsLeft: Math.ceil(r / s.payment), lastDate: s.nextDate } : { ok: false, error: 'Остаток должен быть больше нуля' };
  };
  const methods: [Method, string][] = [...(s.uniform ? ([['term', 'Знаю срок']] as [Method, string][]) : []), ['remaining', 'Знаю остаток'], ['last', 'Последний платёж']];
  const segBox = h('div');
  const sync = () => {
    segBox.replaceChildren(seg(methods, method, (v) => ((method = v), sync()), 'Как посчитать остаток'));
    fTerm.hidden = method !== 'term';
    fRem.hidden = method !== 'remaining';
    fLast.hidden = method !== 'last';
    const r = compute();
    preview.replaceChildren(
      !r ? 'Укажи данные — здесь появится остаток.' : r.ok ? (method === 'remaining' ? `Это около ${nWord(r.paymentsLeft, 'платежа', 'платежей', 'платежей')} по ${fmt(s.payment)}` : `Осталось ${nWord(r.paymentsLeft, 'платёж', 'платежа', 'платежей')} = ${fmt(r.remaining)}, последний ${fmtDate(r.lastDate)}`) : h('span', { class: 'bad' }, r.error),
    );
  };
  const form = h(
    'form',
    { class: 'stack' },
    segBox,
    fTerm,
    fRem,
    fLast,
    preview,
    h('details', { class: 'fold', 'data-key': `suggest:${s.key}:more` }, h('summary', null, 'Название и чья'), h('div', { class: 'grid-form' }, field('Название', title), field('Чья', owner))),
    h('div', { class: 'btn-row' }, h('button', { class: 'btn primary', type: 'submit' }, 'Завести'), h('button', { class: 'btn', type: 'button', onclick: () => act(dismiss(s.key), 'Скрыто — больше не предложится') }, 'Это не рассрочка')),
    err,
  );
  form.addEventListener('input', () => {
    const r = compute();
    preview.textContent = !r ? 'Укажи данные — здесь появится остаток.' : r.ok ? `Осталось ${fmt(r.remaining)}` : r.error;
  });
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const r = compute();
    if (!r || !r.ok) return err.replaceChildren(errorsBox([r ? r.error : 'Укажи срок, остаток или дату последнего платежа']) ?? '');
    const ob = suggestionToObligation(s, { id: newId('ob'), remaining: r.remaining, today: today(), title: title.value, owner: owner.value as 'self' | 'family' });
    const errs = validateObligation(ob);
    if (errs.length) return err.replaceChildren(errorsBox(errs) ?? '');
    await act((x) => ({ ...x, obligations: [...x.obligations, ob] }), `«${ob.title}» заведена`);
  });
  sync();
  // уже заведена вручную — связать, чтобы её платежи находились
  const linkable = st.obligations.filter((x) => x.kind === 'installment');
  const linkSel = h('select', { 'aria-label': 'Заведённая рассрочка' }, linkable.map((x) => h('option', { value: x.id }, x.title)));
  const link = linkable.length
    ? h(
        'details',
        { class: 'fold', 'data-key': `suggest:${s.key}:link` },
        h('summary', null, 'Уже заведена вручную'),
        h('div', { class: 'stack' }, field('Какая', linkSel), h('button', { class: 'btn', type: 'button', onclick: () => act((x) => ({ ...x, obligations: x.obligations.map((y) => (y.id === linkSel.value ? { ...y, match: s.match } : y)) }), 'Связано') }, 'Связать')),
      )
    : null;
  return h(
    'div',
    { class: 'card stack' },
    h('div', { class: 'gh' }, h('strong', null, s.title), s.owner === 'family' ? h('span', { class: 'tag' }, 'семья') : null),
    h('div', { class: 'muted' }, `${nWord(s.count, 'платёж', 'платежа', 'платежей')} по ${fmt(s.payment)}, около ${s.dayOfMonth}-го · следующий ${fmtDate(s.nextDate)}`),
    s.warnings.length ? h('div', { class: 'warnline' }, s.warnings.map((w) => h('div', null, w))) : null,
    form,
    link,
  );
}

const dismiss = (key: string) => (x: AppState): AppState => ({ ...x, settings: { ...x.settings, dismissedInstallments: [...new Set([...x.settings.dismissedInstallments, key])].sort() } });

/** Расхождения заведённых рассрочек с операциями — с кнопкой исправления. */
export function checksBlock(st: AppState, o: Overview): HTMLElement | null {
  const checks = o.installments.checks;
  if (!checks.length) return null;
  return h(
    'div',
    { class: 'stack' },
    ...checks.map((c) => {
      const ob = st.obligations.find((x) => x.id === c.obligationId);
      const status = o.obligations.find((x) => x.obligation.id === c.obligationId);
      let fix: HTMLElement | null = null;
      if (ob && status && c.kind === 'amount' && c.amount) {
        const amount = c.amount;
        fix = h(
          'button',
          {
            class: 'btn',
            type: 'button',
            onclick: () => {
              const next = status.effectiveUpcoming[0]?.date ?? today();
              const upd = makeInstallment({ id: ob.id, title: ob.title, owner: ob.owner, kind: 'installment', remaining: status.remainingNow, remainingAsOf: today(), payment: amount, firstDate: next > today() ? next : today(), ...(ob.match ? { match: ob.match } : {}), interestRateBp: ob.interestRateBp, earlyPayoffAllowed: ob.earlyPayoffAllowed });
              return act((x) => ({ ...x, obligations: x.obligations.map((y) => (y.id === ob.id ? upd : y)) }), 'График обновлён');
            },
          },
          `Обновить платёж на ${fmt(amount)}`,
        );
      } else if (ob && c.kind === 'stalled') {
        fix = h('button', { class: 'btn', type: 'button', onclick: () => act((x) => ({ ...x, obligations: x.obligations.filter((y) => y.id !== ob.id) }), `«${ob.title}» удалена`) }, 'Закрыта — удалить');
      }
      return h('div', { class: 'warnline stack' }, h('div', null, c.text), fix);
    }),
  );
}

// ───────────────────────── бэкап ─────────────────────────

export function renderBackup(): HTMLElement {
  const st = getState();
  const input = h('input', { type: 'file', accept: '.json,application/json', class: 'visually-hidden' });
  input.addEventListener('change', async () => {
    const f = input.files?.[0];
    if (!f) return;
    const r = parseState(await f.text());
    if (!r.ok) return toast(r.error, 'error');
    await act(() => r.value, 'Бэкап восстановлен');
  });
  const erase = async () => {
    const i = await ask({ title: 'Стереть все данные?', text: 'Импорт, разметка, цели, доходы и настройки пропадут с этого устройства. Отменить будет нельзя — сначала скачай бэкап.', actions: [{ label: 'Стереть всё', kind: 'danger' }] });
    if (i !== 0) return;
    await replaceState(emptyState());
    toast('Данные стёрты');
  };
  return h(
    'div',
    { class: 'screen' },
    gray(`Все данные лежат только в этом браузере. Бэкап — один файл с ними: скачивай раз в месяц и перед обновлением.${st.lastBackupAt ? ` Последний — ${fmtDate(st.lastBackupAt)}.` : ''}`),
    h(
      'div',
      { class: 'stack' },
      h(
        'button',
        {
          class: 'btn primary wide',
          type: 'button',
          onclick: async () => {
            // дата скачивания запоминается до сериализации — она попадёт и в сам бэкап
            await update((x) => ({ ...x, lastBackupAt: today() }));
            download(`capital-os-${today()}.json`, serializeState(getState(), today()));
          },
        },
        'Скачать бэкап',
      ),
      h('label', { class: 'btn wide file-btn' }, 'Восстановить из файла', input),
    ),
    h('div', { class: 'foot-note' }, h('button', { class: 'btn danger link', type: 'button', onclick: erase }, 'Стереть все данные')),
  );
}

export function renderInstall(): HTMLElement {
  return h('div', { class: 'screen' }, installBlock());
}

// ───────────────────────── редкое ─────────────────────────

export function renderRare(section?: string): HTMLElement {
  const st = getState();
  const root = h('div', { class: 'screen' });
  if (section === 'debts') return (root.append(sub('Долги на начало учёта', info('openingDebts')), openingDebts(st)), root);
  if (section === 'manual') return (root.append(sub('Ручные счета'), manualAccounts(st)), root);
  if (section === 'adjustments') return (root.append(sub('Корректировки'), adjustments(st)), root);
  const d = st.settings.openingDebts;
  root.append(
    rows(
      row({ title: 'Долги на начало учёта', sub: d.acknowledged ? 'сумма неизвестна, считается 0' : d.receivable || d.payable ? `тебе должны ${fmt(d.receivable)} · ты должен ${fmt(d.payable)}` : 'долг, возникший до первой операции в бэкапе', href: '#/rare/debts' }),
      row({ title: 'Ручные счета', sub: 'счёт, которого нет в MoneyManager', value: st.manualAccounts.length ? String(st.manualAccounts.length) : undefined, href: '#/rare/manual' }),
      row({ title: 'Корректировки', sub: 'разовая поправка баланса с причиной', value: st.adjustments.length ? String(st.adjustments.length) : undefined, href: '#/rare/adjustments' }),
    ),
  );
  return root;
}

function openingDebts(st: AppState): HTMLElement {
  const d = st.settings.openingDebts;
  const neg = ov().capital.explanation.filter((x) => x.code === 'capital.payables_negative' || x.code === 'capital.receivables_negative');
  const err = h('div');
  const form = h('form', { class: 'stack' }, h('div', { class: 'grid-form' }, field('Мне были должны, ₸', moneyInput('rec', d.receivable)), field('Я был должен, ₸', moneyInput('pay', d.payable))), err, h('button', { class: 'btn primary wide', type: 'submit' }, 'Сохранить суммы'));
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const receivable = readMoney(form, 'rec');
    const payable = readMoney(form, 'pay');
    if (receivable === null || payable === null || receivable < 0 || payable < 0) return err.replaceChildren(errorsBox(['Введи неотрицательные суммы (0, если долга не было)']) ?? '');
    await act((s) => ({ ...s, settings: { ...s.settings, openingDebts: { receivable, payable } } }), 'Долги на начало учёта сохранены');
  });
  return h(
    'div',
    { class: 'stack' },
    gray('Долг, который появился до первой операции в бэкапе: в данных есть только его возврат. Текущие долги веди в MoneyManager категориями с типами «Выдал в долг», «Взял в долг» и т. д.'),
    neg.length ? h('div', { class: 'warnline' }, neg.map((x) => h('div', null, x.text))) : null,
    d.acknowledged
      ? h('div', { class: 'okline' }, '✓ Принято: сумма неизвестна, считается 0', h('button', { class: 'btn link', type: 'button', onclick: () => act((s) => ({ ...s, settings: { ...s.settings, openingDebts: { ...s.settings.openingDebts, acknowledged: false } } }), 'Снова спросим') }, 'Отменить'))
      : neg.length
        ? h('button', { class: 'btn wide', type: 'button', onclick: () => act((s) => ({ ...s, settings: { ...s.settings, openingDebts: { ...s.settings.openingDebts, acknowledged: true } } }), 'Принято: сумма неизвестна, считается 0') }, 'Не знаю — считать 0')
        : null,
    sub('Я знаю суммы'),
    form,
  );
}

function manualAccounts(st: AppState): HTMLElement {
  return h(
    'div',
    { class: 'stack' },
    gray('Депозит в другом банке, деньги у родителей — то, чего нет в MoneyManager. Задаётся остатком на дату.'),
    st.manualAccounts.length
      ? rows(st.manualAccounts.map((m) => row({ title: m.title, sub: `на ${fmtDate(m.balanceDate)} · снять ${liqLabel(m.liquidity)}${m.deposit ? ` · ${(m.deposit.rateBp / 100).toLocaleString('ru-RU')} % годовых` : ''}`, value: fmt(m.balance), href: sheetHref('manual', m.id) })))
      : null,
    h('a', { class: 'btn wide', href: sheetHref('manual', 'new') }, '＋ Ручной счёт'),
  );
}

defineSheet('manual', (id) => {
  const st = getState();
  const m = id === 'new' ? null : st.manualAccounts.find((x) => x.id === id);
  if (id !== 'new' && !m) return null;
  let liq: Liquidity = m?.liquidity ?? { kind: 'instant' };
  const err = h('div');
  const form = h(
    'form',
    { class: 'stack', id: 'manual-form' },
    field('Название', h('input', { name: 'title', required: true, value: m?.title ?? '', placeholder: 'Депозит в другом банке', autocomplete: 'off' })),
    h('div', { class: 'grid-form' }, field('Остаток, ₸', moneyInput('balance', m?.balance)), field('На дату', h('input', { name: 'date', type: 'date', value: m?.balanceDate ?? today() }))),
    h('div', { class: 'field' }, h('span', { class: 'field-label' }, 'Когда можно снять'), liquidityPicker(liq, (l) => (liq = l))),
    h(
      'details',
      { class: 'fold', 'data-key': 'manual:more' },
      h('summary', null, 'Проценты и комментарий'),
      h(
        'div',
        { class: 'stack' },
        field('Ставка, % годовых', h('input', { name: 'rate', inputmode: 'decimal', value: m?.deposit ? String(m.deposit.rateBp / 100).replace('.', ',') : '', placeholder: 'пусто — без процентов' })),
        field('Проценты начисляются', h('select', { name: 'cap' }, h('option', { value: 'monthly', selected: m?.deposit?.capitalization !== 'daily' }, 'раз в месяц'), h('option', { value: 'daily', selected: m?.deposit?.capitalization === 'daily' }, 'каждый день'))),
        field('Комментарий', h('input', { name: 'comment', value: m?.comment ?? '', autocomplete: 'off' })),
      ),
    ),
    err,
  );
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const errs: string[] = [];
    const title = readStr(form, 'title');
    const balance = readMoney(form, 'balance');
    const rateStr = readStr(form, 'rate').replace(',', '.');
    let rateBp: number | null = null;
    if (rateStr) {
      const mm = /^(\d{1,3})(?:\.(\d{1,2}))?$/.exec(rateStr);
      if (!mm) errs.push('Ставка: число с точностью до сотых, например 14,5');
      else rateBp = Number(mm[1]) * 100 + Number((mm[2] ?? '').padEnd(2, '0') || 0);
    }
    if (!title) errs.push('Нужно название');
    if (balance === null) errs.push('Остаток: введи сумму в тенге');
    err.replaceChildren(errorsBox(errs) ?? '');
    if (errs.length) return;
    const { deposit: _d, ...prev } = m ?? ({} as Partial<ManualAccount>);
    const acc: ManualAccount = {
      ...prev,
      id: m?.id ?? newId('man'),
      title,
      balance: balance!,
      balanceDate: readStr(form, 'date') || today(),
      liquidity: liq,
      comment: readStr(form, 'comment'),
      ...(rateBp !== null ? { deposit: { rateBp, capitalization: readStr(form, 'cap') as 'monthly' | 'daily' } } : {}),
    };
    closeSheet();
    await act((s) => ({ ...s, manualAccounts: m ? s.manualAccounts.map((x) => (x.id === m.id ? acc : x)) : [...s.manualAccounts, acc] }), m ? 'Счёт сохранён' : 'Счёт добавлен');
  });
  const remove = m
    ? h('button', {
        class: 'btn danger wide',
        type: 'button',
        onclick: async () => {
          if ((await ask({ title: `Удалить «${m.title}»?`, actions: [{ label: 'Удалить', kind: 'danger' }] })) !== 0) return;
          closeSheet();
          await act((s) => ({ ...s, manualAccounts: s.manualAccounts.filter((x) => x.id !== m.id) }), `«${m.title}» удалён`);
        },
      }, 'Удалить счёт')
    : null;
  return { title: m ? m.title : 'Ручной счёт', body: h('div', { class: 'stack' }, form, remove), bar: stickyBar(null, h('button', { class: 'btn primary', type: 'submit', form: 'manual-form' }, m ? 'Сохранить' : 'Добавить')) };
});

function adjustments(st: AppState): HTMLElement {
  const accs = [...(st.imported?.accounts ?? []).filter((a) => !a.removed), ...st.manualAccounts.map((m) => ({ id: m.id, title: m.title }))];
  const title = (id: string) => accs.find((a) => a.id === id)?.title ?? id;
  const err = h('div');
  const form = h(
    'form',
    { class: 'stack' },
    field('Счёт', h('select', { name: 'acc' }, accs.map((a) => h('option', { value: a.id }, a.title)))),
    h('div', { class: 'grid-form' }, field('Сумма, ₸', moneyInput('amount'), 'минус — уменьшить'), field('Дата', h('input', { name: 'date', type: 'date', value: today() }))),
    field('Причина', h('input', { name: 'comment', required: true, autocomplete: 'off' })),
    err,
    h('button', { class: 'btn primary wide', type: 'submit' }, 'Добавить корректировку'),
  );
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const amount = readMoney(form, 'amount');
    const adj = { id: newId('adj'), accountId: readStr(form, 'acc'), date: readStr(form, 'date') || today(), amount: amount ?? (0 as never), comment: readStr(form, 'comment') };
    const errs = amount === null ? ['Введи сумму'] : validateAdjustment(adj);
    err.replaceChildren(errorsBox(errs) ?? '');
    if (errs.length) return;
    await act((s) => ({ ...s, adjustments: [...s.adjustments, adj] }), 'Корректировка добавлена');
  });
  return h(
    'div',
    { class: 'stack' },
    gray('Когда в MoneyManager что-то не внесено и исправить там нельзя. В сверку импорта не входит, в капитал входит.'),
    st.adjustments.length
      ? rows(
          st.adjustments.map((a) =>
            row({
              title: `${fmt(a.amount, true)} · ${title(a.accountId)}`,
              sub: `${fmtDate(a.date)} · ${a.comment}`,
              value: h('span', { class: 'chip' }, 'Удалить'),
              chevron: false,
              onClick: () => void act((s) => ({ ...s, adjustments: s.adjustments.filter((x) => x.id !== a.id) }), 'Корректировка удалена'),
            }),
          ),
        )
      : null,
    sub('Новая корректировка'),
    form,
  );
}

// ───────────────────────── для продвинутых ─────────────────────────

export function renderAdvanced(section?: string): HTMLElement {
  const st = getState();
  const root = h('div', { class: 'screen' });
  if (section === 'rules') return (root.append(sub('Правила разметки'), rulesBlock(st)), root);
  if (section === 'params') return (root.append(sub('Параметры'), paramsBlock(st)), root);
  if (section === 'strategy') return (root.append(sub('Варианты распределения', info('strategies')), strategyBlock(st)), root);
  if (section === 'scenarios') return (root.append(sub('Сценарии «Хуже» и «Лучше»', info('scenarios')), scenariosBlock(st)), root);
  root.append(
    gray('Значения по умолчанию подходят большинству. Меняй, только если знаешь зачем.'),
    rows(
      row({ title: 'Правила разметки', sub: `категория → тип · ${nWord(st.settings.classification.rules.length, 'правило', 'правила', 'правил')}`, href: '#/advanced/rules' }),
      row({ title: 'Параметры', sub: `подушка ${st.settings.reserveMonths} мес. · инфляция ${(st.settings.inflationBp / 100).toLocaleString('ru-RU')} %`, href: '#/advanced/params' }),
      row({ title: 'Варианты распределения', sub: `текущий план — «${STRAT[st.settings.planStrategy as 'A' | 'B' | 'C'] ?? 'Баланс'}»`, href: '#/advanced/strategy' }),
      row({ title: 'Сценарии «Хуже» и «Лучше»', sub: 'насколько хуже или лучше плана', href: '#/advanced/scenarios' }),
    ),
  );
  return root;
}

const STRAT: Record<'A' | 'B' | 'C', string> = { A: 'Безопасность', B: 'Баланс', C: 'Ускорение' };

function rulesBlock(st: AppState): HTMLElement {
  const reg = classRegistry(st.settings.classes);
  const cats = new Map((st.imported?.categories ?? []).map((c) => [c.id, catName(c)]));
  const ruleName = (r: CategoryRule) => (r.categoryId ? cats.get(r.categoryId) ?? 'категория удалена' : r.categoryTitle ?? '—');
  const fam = h('input', { name: 'family', value: st.settings.classification.familyTags.join(', '), placeholder: 'мама, папа', autocomplete: 'off' });
  const famForm = h('form', { class: 'stack' }, field('Теги, которые делают рассрочку семейной', fam, 'через запятую'), h('button', { class: 'btn wide', type: 'submit' }, 'Сохранить теги'));
  famForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const familyTags = fam.value.split(',').map((t) => t.trim()).filter(Boolean);
    void act((s) => ({ ...s, settings: { ...s.settings, classification: { ...s.settings.classification, familyTags } } }), 'Теги сохранены');
  });
  const fileIn = h('input', { type: 'file', accept: '.json,application/json', class: 'visually-hidden' });
  fileIn.addEventListener('change', async () => {
    const f = fileIn.files?.[0];
    if (!f) return;
    let rules: unknown;
    try {
      rules = JSON.parse(await f.text());
    } catch {
      return toast('В файле не правила: это не JSON', 'error');
    }
    const v = validateClassification({ rules, familyTags: getState().settings.classification.familyTags }, getState().settings.classes.custom.map((c) => c.id));
    if (!v.ok) return toast(v.errors.join('; '), 'error');
    await act((s) => ({ ...s, settings: { ...s.settings, classification: v.value } }), 'Правила загружены');
  });
  const rules = st.settings.classification.rules;
  return h(
    'div',
    { class: 'stack' },
    gray('По этим правилам категории MoneyManager получают тип. Новые правила появляются сами, когда ты размечаешь категории.'),
    rules.length
      ? h(
          'table',
          { class: 'tbl four rules' },
          h('thead', null, h('tr', null, h('th', { scope: 'col' }, 'Категория'), h('th', { scope: 'col' }, 'Тип'), h('th', { scope: 'col' }, h('span', { class: 'visually-hidden' }, 'Удалить')))),
          h(
            'tbody',
            null,
            rules.map((r, i) =>
              h(
                'tr',
                null,
                h('th', { scope: 'row' }, ruleName(r), r.opKind ? h('div', { class: 'muted' }, r.opKind === 'income' ? 'доход' : 'трата') : null),
                h('td', null, typeLabel(r.class, reg), r.refine?.length ? h('div', { class: 'muted' }, 'с семейным тегом — семейная') : null),
                h('td', null, h('button', { class: 'btn small', type: 'button', 'aria-label': `Удалить правило «${ruleName(r)}»`, onclick: () => act((s) => ({ ...s, settings: { ...s.settings, classification: { ...s.settings.classification, rules: s.settings.classification.rules.filter((_, k) => k !== i) } } }), `Правило «${ruleName(r)}» удалено`) }, '✕')),
              ),
            ),
          ),
        )
      : gray('Правил нет.'),
    h(
      'details',
      { class: 'fold', 'data-key': 'rules:more' },
      h('summary', null, 'Семейные теги, файл правил, сброс'),
      h(
        'div',
        { class: 'stack' },
        famForm,
        h(
          'div',
          { class: 'btn-row' },
          h('button', { class: 'btn', type: 'button', onclick: () => download(`capital-os-rules-${today()}.json`, JSON.stringify(getState().settings.classification.rules, null, 2)) }, 'Скачать правила'),
          h('label', { class: 'btn file-btn' }, 'Загрузить из файла', fileIn),
        ),
        h('button', { class: 'btn link', type: 'button', onclick: () => act((s) => ({ ...s, settings: { ...s.settings, classification: structuredClone(DEFAULT_CLASSIFICATION) } }), 'Правила сброшены к начальным') }, 'Сбросить к начальным правилам'),
      ),
    ),
  );
}

function paramsBlock(st: AppState): HTMLElement {
  const s = st.settings;
  const num = (name: string, v: number, min = 0) => h('input', { name, type: 'number', min, step: 1, inputmode: 'numeric', value: v });
  const form = h(
    'form',
    { class: 'stack' },
    field('Подушка — сколько месяцев обычных базовых трат', num('reserveMonths', s.reserveMonths, 1)),
    field('Обычный месяц считать по последним … полным месяцам', num('baselineMonths', s.baselineMonths, 1), 'берётся медиана — один дорогой месяц её почти не сдвигает'),
    field('Если доходы не заданы — считать «Свободно» на … дней вперёд', num('defaultIncomeHorizonDays', s.defaultIncomeHorizonDays, 1)),
    field('Платёж по рассрочке засчитывается, если пришёл в пределах ± … дней', num('matchWindowDays', s.matchWindowDays)),
    field('Инфляция, % в год', h('input', { name: 'inflation', inputmode: 'decimal', value: String(s.inflationBp / 100).replace('.', ',') })),
    h('button', { class: 'btn primary wide', type: 'submit' }, 'Сохранить'),
  );
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const n = (k: string, min: number) => Math.max(min, Math.floor(Number(readStr(form, k)) || min));
    const infl = Math.round(Number(readStr(form, 'inflation').replace(',', '.')) * 100);
    void act(
      (x) => ({
        ...x,
        settings: { ...x.settings, reserveMonths: n('reserveMonths', 1), baselineMonths: n('baselineMonths', 1), defaultIncomeHorizonDays: n('defaultIncomeHorizonDays', 1), matchWindowDays: n('matchWindowDays', 0), inflationBp: Number.isSafeInteger(infl) && infl >= 0 ? infl : x.settings.inflationBp },
      }),
      'Параметры сохранены',
    );
  });
  return form;
}

function strategyBlock(st: AppState): HTMLElement {
  const s = st.settings.strategy;
  const pctv = (bp: number) => String(bp / 100).replace('.', ',');
  let plan = st.settings.planStrategy as StrategyId;
  const planBox = h('div');
  const drawPlan = () => planBox.replaceChildren(seg([['A', 'Безопасность'], ['B', 'Баланс'], ['C', 'Ускорение']] as const, plan as 'A' | 'B' | 'C', (v) => ((plan = v), drawPlan()), 'Текущий план'));
  drawPlan();
  const form = h(
    'form',
    { class: 'stack' },
    h('div', { class: 'field' }, h('span', { class: 'field-label' }, 'Текущий план'), planBox, h('small', { class: 'hint' }, 'так распределяется прирост в прогнозе; от него считается «цена» вариантов')),
    field('Прогноз на сколько месяцев', h('input', { name: 'months', type: 'number', min: 6, max: 120, inputmode: 'numeric', value: st.settings.simulationMonths })),
    field('«Безопасность»: подушка больше минимума, % от минимума', h('input', { name: 'comfort', inputmode: 'decimal', value: pctv(s.comfortReserveBp) })),
    field('«Безопасность»: какая доля остатка идёт в подушку, %', h('input', { name: 'cushion', inputmode: 'decimal', value: pctv(s.cushionShareBp) })),
    field('За сколько месяцев до срока цель становится срочной', h('input', { name: 'urgency', type: 'number', min: 1, inputmode: 'numeric', value: s.urgencyMonths })),
    field('Обязательный взнос округлять вверх до, ₸', moneyInput('step', s.requiredStep)),
    field('Считать варианты одинаковыми при разнице меньше, ₸', moneyInput('merge', s.mergeTolerance)),
    h('button', { class: 'btn primary wide', type: 'submit' }, 'Сохранить'),
  );
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const bp = (k: string, d: number) => {
      const v = Math.round(Number(readStr(form, k).replace(',', '.')) * 100);
      return Number.isSafeInteger(v) && v >= 0 ? v : d;
    };
    void act(
      (x) => ({
        ...x,
        settings: {
          ...x.settings,
          planStrategy: plan as 'A' | 'B' | 'C',
          simulationMonths: Math.min(120, Math.max(6, Math.floor(Number(readStr(form, 'months')) || 36))),
          strategy: {
            comfortReserveBp: bp('comfort', s.comfortReserveBp),
            cushionShareBp: Math.min(10000, bp('cushion', s.cushionShareBp)),
            urgencyMonths: Math.max(1, Math.floor(Number(readStr(form, 'urgency')) || s.urgencyMonths)),
            requiredStep: readMoney(form, 'step') ?? s.requiredStep,
            mergeTolerance: readMoney(form, 'merge') ?? s.mergeTolerance,
          },
        },
      }),
      'Сохранено',
    );
  });
  return form;
}

function scenariosBlock(st: AppState): HTMLElement {
  const pctv = (bp: number | undefined) => (bp === undefined ? '' : String(bp / 100).replace('.', ','));
  const kinds = incomeKindRegistry(st.settings.incomeKinds);
  const blocks = st.settings.scenarios
    .filter((sc) => sc.id !== 'base')
    .map((sc) => {
      const p = sc.patch;
      const form = h(
        'form',
        { class: 'stack' },
        // доходы — по видам: встроенные и свои (D75)
        ...kinds.flatMap((k) => {
          const b = kindBehavior(p, k.id);
          return [
            h('div', { class: 'grid-form' }, field(`«${k.label}»: остаётся, %`, h('input', { name: `f-${k.id}`, inputmode: 'decimal', value: pctv(b.factorBp), placeholder: '100' })), field(`«${k.label}»: позже на, мес.`, h('input', { name: `d-${k.id}`, type: 'number', min: 0, max: 24, inputmode: 'numeric', value: b.delayMonths }))),
          ];
        }),
        field('Траты, % от обычного месяца', h('input', { name: 'exp', inputmode: 'decimal', value: pctv(p.expenseFactorBp), placeholder: '100' })),
        h('div', { class: 'grid-form' }, field('Внезапная трата, % месяца базовых трат', h('input', { name: 'oneoff', inputmode: 'decimal', value: pctv(p.oneOffMonthsOfBaseBp), placeholder: '0' })), field('…через сколько месяцев', h('input', { name: 'offset', type: 'number', min: 0, inputmode: 'numeric', value: p.oneOffMonthOffset ?? 1 }))),
        h('button', { class: 'btn primary wide', type: 'submit' }, `Сохранить «${scenarioWord(sc)}»`),
      );
      form.addEventListener('submit', (e) => {
        e.preventDefault();
        const bp = (k: string) => {
          const t = readStr(form, k);
          if (!t) return undefined;
          const v = Math.round(Number(t.replace(',', '.')) * 100);
          return Number.isSafeInteger(v) && v >= 0 ? v : undefined;
        };
        const factors: Record<string, number> = {};
        const delays: Record<string, number> = {};
        for (const k of kinds) {
          factors[k.id] = Math.min(30000, bp(`f-${k.id}`) ?? 10000);
          const d = Math.min(24, Math.max(0, Math.floor(Number(readStr(form, `d-${k.id}`)) || 0)));
          // явный 0 для «работы» нужен, чтобы перекрыть старое поле задержки
          if (d || k.id === 'work') delays[k.id] = d;
        }
        const rest = { expenseFactorBp: bp('exp'), oneOffMonthsOfBaseBp: bp('oneoff'), oneOffMonthOffset: Math.max(0, Math.floor(Number(readStr(form, 'offset')) || 0)) };
        const clean = { ...Object.fromEntries(Object.entries(rest).filter(([, v]) => v !== undefined)), incomeFactorsBp: factors, incomeDelayMonths: delays };
        void act((x) => ({ ...x, settings: { ...x.settings, scenarios: x.settings.scenarios.map((y) => (y.id === sc.id ? { ...y, patch: clean } : y)) } }), `«${scenarioWord(sc)}» сохранён`);
      });
      return h('details', { class: 'fold', 'data-key': `scenario:${sc.id}` }, h('summary', null, scenarioWord(sc)), form);
    });
  return h('div', { class: 'stack' }, gray('Насколько хуже или лучше плана считаются сценарии: каждый вид дохода, траты, внезапная трата.'), ...blocks);
}


