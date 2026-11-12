/**
 * «Пришли деньги» (D96, вместо «Доход» с «Проверить решение»): сколько пришло (из бэкапа или руками) →
 * одна цифра «Можно отложить X» с разбивкой по целям → сколько останется на жизнь до следующего дохода →
 * «переведи в банке» → «Перевёл в банке — подтвердить» (D105).
 * Старый экран сравнения вариантов — «Другие способы распределить».
 */
import { arrivedIncomes, commitSetAside, spendGap, splitAmount, splitIncome, type ArrivedIncome, type Money, type SimpleSplit } from '../../engine/index';
import { h, toast } from '../dom';
import { getState, today, update } from '../store';
import { errorsBox, fmt, fmtDay, moneyInput, newId, readMoney, row, rows, seg, stickyBar } from '../ui';
import { closeSheet, defineSheet, go, sheetHref } from '../main';
import { ov } from '../ctx';
import { flashGoals } from './goals';

/** Выбор человека: поступление из бэкапа (id операции) или своя сумма. */
let pick: { kind: 'op'; opId: string } | { kind: 'manual'; amount: Money; inBalance: boolean } | null = null;

interface Arrived {
  amount: Money;
  inBalance: boolean;
  accountId: string | null;
  title: string;
  date?: string;
}

function current(found: ArrivedIncome[]): Arrived | null {
  if (pick?.kind === 'manual') return { amount: pick.amount, inBalance: pick.inBalance, accountId: null, title: 'введено вручную' };
  const want = pick?.kind === 'op' ? pick.opId : null;
  const op = (want ? found.find((x) => x.opId === want) : undefined) ?? found[0];
  return op ? { amount: op.amount, inBalance: true, accountId: op.accountId, title: op.title, date: op.date } : null;
}

/** Счёт для меток, если сумма введена вручную: счёт для трат с наибольшим свободным остатком. */
function spendAccount(): string | null {
  const o = ov();
  const assigned = new Map<string, number>();
  for (const f of o.fundings) assigned.set(f.accountId, (assigned.get(f.accountId) ?? 0) + f.amount);
  const c = o.capital.accounts
    .filter((p) => !p.excluded && o.spend.kinds[p.accountId] === 'spend' && p.availableFrom <= today())
    .map((p) => ({ id: p.accountId, free: p.balance - (assigned.get(p.accountId) ?? 0) }))
    .sort((a, b) => b.free - a.free)[0];
  return c?.id ?? null;
}

function manualForm(onDone: () => void, prefill?: Money): HTMLElement {
  let inBalance = true;
  const amount = moneyInput('amount', prefill, '0');
  amount.classList.add('big-input');
  const segBox = h('div');
  const drawSeg = () => segBox.replaceChildren(seg([['yes', 'Да'], ['no', 'Ещё нет']] as const, inBalance ? 'yes' : 'no', (x) => ((inBalance = x === 'yes'), drawSeg()), 'Уже есть в бэкапе MoneyManager?'));
  drawSeg();
  const err = h('div');
  const f = h(
    'form',
    { class: 'stack', id: 'arrived-manual' },
    h('label', { class: 'field' }, h('span', { class: 'field-label' }, 'Сколько пришло, ₸'), amount),
    h('div', { class: 'field' }, h('span', { class: 'field-label' }, 'Эти деньги уже есть в загруженном бэкапе?'), segBox),
    err,
    h('button', { class: 'btn primary wide', type: 'submit' }, 'Посчитать'),
  );
  f.addEventListener('submit', (e) => {
    e.preventDefault();
    const a = readMoney(f, 'amount');
    if (a === null || a <= 0) return err.replaceChildren(errorsBox(['Введи, сколько пришло']) ?? '');
    pick = { kind: 'manual', amount: a, inBalance };
    onDone();
  });
  return f;
}

defineSheet('arrived-pick', () => {
  const found = arrivedIncomes(getState(), today(), ov());
  return {
    title: 'Что пришло',
    body: h(
      'div',
      { class: 'stack' },
      found.length
        ? rows(found.map((x) => row({ title: `${fmt(x.amount)} · ${x.title}`, sub: `${fmtDay(x.date)} · нашлось в бэкапе`, onClick: () => ((pick = { kind: 'op', opId: x.opId }), closeSheet()) })))
        : h('p', { class: 'muted' }, 'Новых поступлений в бэкапе нет.'),
      h('h3', { class: 'sub' }, h('span', null, 'Или введи сумму')),
      manualForm(() => closeSheet()),
    ),
  };
});

async function commit(byGoal: Record<string, Money>, a: Arrived, total: Money): Promise<void> {
  // денег ещё нет в бэкапе — отметки встали бы на старые деньги на счёте (D103)
  if (!a.inBalance) return toast('Этих денег ещё нет в бэкапе. Загрузи свежий бэкап — тогда подтвердишь', 'error');
  const acc = a.accountId ?? spendAccount();
  if (!acc) return toast('Нет счёта для трат, куда пришли деньги', 'error');
  const before = getState();
  const r = commitSetAside(before, byGoal, acc, today(), newId('dec'), { income: a.amount });
  if (!r.ok) return toast(r.error, 'error');
  pick = null;
  flashGoals(Object.keys(byGoal));
  await update(() => r.value);
  toast(`Отмечено: ${fmt(total)} на цели. Перевод проверится по следующему бэкапу`, { undo: () => update(() => before).then(() => toast('Отменено')) });
  go('#/overview');
}

defineSheet('setaside-other', () => {
  const found = arrivedIncomes(getState(), today(), ov());
  const a = current(found);
  if (!a) return null;
  const amount = moneyInput('amount', undefined, '0');
  amount.classList.add('big-input');
  const preview = h('div', { class: 'stack' });
  const err = h('div');
  let plan: ReturnType<typeof splitAmount> | null = null;
  const draw = () => {
    const f = amount.closest('form') as HTMLFormElement | null;
    const m = f ? readMoney(f, 'amount') : null;
    plan = m && m > 0 ? splitAmount(getState(), today(), m) : null;
    preview.replaceChildren(plan && plan.lines.length ? rows(plan.lines.map((l) => row({ title: l.title, value: fmt(l.amount) }))) : h('p', { class: 'muted' }, 'Сумма разложится по целям в порядке списка.'));
  };
  const form = h('form', { id: 'setaside-other-form', class: 'stack' }, h('label', { class: 'field' }, h('span', { class: 'field-label' }, 'Сколько отложить, ₸'), amount), preview, transferNote(), err);
  amount.addEventListener('input', draw);
  queueMicrotask(draw);
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    draw();
    if (!plan || !plan.lines.length) return err.replaceChildren(errorsBox(['Введи сумму больше нуля — и чтобы было на какие цели']) ?? '');
    const total = plan.lines.reduce((s, l) => s + l.amount, 0) as Money;
    closeSheet();
    await commit(plan.byGoal, a, total);
  });
  return { title: 'Отложить другую сумму', body: form, bar: stickyBar(null, h('button', { class: 'btn primary', type: 'submit', form: 'setaside-other-form' }, CONFIRM)) };
});

/** Кнопка подтверждения: человек сначала переводит в банке, потом отмечает здесь (D105). */
const CONFIRM = 'Перевёл в банке — подтвердить';

/** Предупреждение перед кнопкой: приложение само ничего не переводит. */
function transferNote(amount?: Money): HTMLElement {
  return h(
    'div',
    { class: 'warnline' },
    h('strong', null, 'Приложение ничего не переводит. '),
    amount ? `Сначала переведи ${fmt(amount)} на копилку в банке, потом нажми кнопку. ` : 'Сначала переведи эту сумму на копилку в банке, потом нажми кнопку. ',
    'С этой минуты сумма не считается деньгами на жизнь, а следующий бэкап покажет, дошёл ли перевод.',
  );
}

function adviceCard(sp: SimpleSplit, a: Arrived): HTMLElement {
  const gap = spendGap(ov().spend);
  // Деньги уже в балансе, а на счетах для трат их нет — значит они лежат в копилке: откладывать нечего, нужно наоборот снять (D182)
  if (a.inBalance && gap) {
    return h(
      'div',
      { class: 'advice' },
      h('div', { class: 'big' }, gap.covered ? `С копилки нужно перевести ${fmt(gap.gap)}` : `До ${fmtDay(sp.nextIncome)} не хватает ${fmt(gap.gap)}`),
      h('div', null, `Эти деньги уже лежат на копилке, а на счетах для трат до ${fmtDay(sp.nextIncome)} не хватает на платежи и обычные траты.`, gap.covered ? ` Переведи с копилки ${fmt(gap.gap)} — всего там ${fmt(gap.savings)}. Цели при этом чуть сдвинутся.` : ` В копилках доступно ${fmt(gap.savings)} — этого мало, придётся ужаться или сдвинуть платёж.`),
      sp.payments.length ? h('div', { class: 'gs' }, `Платежи до дохода: ${sp.payments.map((p) => `${p.title} ${fmt(p.amount)} (${fmtDay(p.date)})`).join(', ')}`) : null,
      h('a', { class: 'btn wide', href: sheetHref('setaside-other') }, 'Всё равно отложить другую сумму'),
    );
  }
  const enough = sp.life >= 0 ? ' — обычные траты покрыты.' : ' — на обычные траты не хватает, придётся ужаться.';
  const shortFor = new Map(sp.short.map((x) => [x.goalId, x]));
  const items = sp.lines.map((l) => {
    const s = shortFor.get(l.goalId);
    const why = s ? `к ${fmtDay(s.deadline)} нужно ${fmt(s.required)} — не хватает, сдвинь срок?` : l.why;
    return h('li', null, `${l.title} — ${fmt(l.amount)}`, why ? h('span', { class: 'gs' }, ` (${why})`) : null);
  });
  return h(
    'div',
    { class: 'advice' },
    sp.fromSavings.total > 0
      ? h(
          'div',
          { class: 'gs' },
          `В копилках уже лежит ${fmt(sp.fromSavings.total)}, не закреплённые за целями: они закроют ${sp.fromSavings.lines.map((l) => `«${l.title}» (${fmt(l.amount)})`).join(', ')}. Поступление ниже посчитано после них. `,
          h('a', { href: '#/goals~distribute' }, 'Распределить копилки ›'),
        )
      : null,
    h('div', { class: 'big' }, sp.setAside > 0 ? `Можно отложить ${fmt(sp.setAside)}` : 'Откладывать не нужно'),
    items.length ? h('ul', null, items) : h('div', { class: 'gs' }, 'Целей пока нет — всё остаётся на жизнь. ', h('a', { href: '#/goals' }, 'Добавить цель ›')),
    h('div', null, `После платежей и обычных трат до ${fmtDay(sp.nextIncome)} останется `, h('b', null, `${fmt(sp.life)} ≈ ${fmt(sp.lifePerDay)} в день сверх обычного`), `${enough}`),
    sp.payments.length ? h('div', { class: 'gs' }, `Уже вычтено: ${sp.payments.map((p) => `${p.title} ${fmt(p.amount)} (${fmtDay(p.date)})`).join(', ')}`) : null,
    sp.setAside > 0 && !a.inBalance
      ? [
          h('div', { class: 'warnline' }, 'Это расчёт заранее: денег ещё нет в бэкапе. Когда придут — загрузи свежий бэкап, и здесь можно будет подтвердить.'),
          h('a', { class: 'btn primary wide', href: '#/import' }, 'Загрузить свежий бэкап'),
        ]
      : null,
    sp.setAside > 0 && a.inBalance
      ? [
          transferNote(sp.setAside),
          h('button', { class: 'btn primary wide', type: 'button', onclick: () => void commit(Object.fromEntries(sp.lines.map((l) => [l.goalId, l.amount])), a, sp.setAside) }, CONFIRM),
        ]
      : null,
    a.inBalance ? h('a', { class: 'btn wide', href: sheetHref('setaside-other') }, 'Отложить другую сумму') : null,
  );
}

/** Поступления, по которым человек сказал «посчитай» в этот раз (D100): без этого — сначала вопрос. */
const asked = new Set<string>();

function handledKey(a: Arrived, found: ArrivedIncome[]): string | null {
  if (!a.date) return null;
  return found.find((x) => x.date === a.date && x.amount === a.amount && x.accountId === a.accountId)?.opId ?? null;
}

/** «Уже распределил»: поступление больше не предлагается (можно отменить). */
async function markHandled(opId: string, title: string): Promise<void> {
  const before = getState();
  pick = null;
  await update((s) => ({ ...s, settings: { ...s.settings, handledIncomes: [...(s.settings.handledIncomes ?? []), opId] } }));
  toast(`«${title}» больше не предлагаю распределить`, { undo: () => update(() => before).then(() => toast('Отменено')) });
}

export function renderArrived(rerender: () => void): HTMLElement {
  const st = getState();
  const root = h('div', { class: 'screen' });
  if (!st.imported) {
    root.append(
      h('div', { class: 'card stack' }, h('strong', null, 'Сначала загрузи бэкап'), h('p', { class: 'muted' }, 'Без него неизвестны балансы и обычные траты — делить пришедшие деньги не из чего.'), h('a', { class: 'btn primary wide', href: '#/import' }, 'Загрузить бэкап')),
    );
    return root;
  }
  const found = arrivedIncomes(st, today(), ov());
  const a = current(found);
  if (!a) {
    root.append(
      h('p', { class: 'muted' }, 'Пришли деньги? Новых поступлений в бэкапе пока нет. Когда придут — загрузи свежий бэкап или введи сумму: приложение подскажет, сколько можно отложить и сколько останется на жизнь.'),
      h('a', { class: 'btn wide', href: '#/import' }, 'Загрузить свежий бэкап'),
      manualForm(rerender),
      rows(row({ title: 'Другие способы распределить', sub: 'сравнить варианты: больше в подушку, быстрее к одной цели', href: '#/income-more' })),
    );
    return root;
  }
  const opId = handledKey(a, found);
  const head = rows(
    row({
      title: `Пришло ${fmt(a.amount)}`,
      sub: a.date ? `${a.title} · ${fmtDay(a.date)} · нашлось в бэкапе${found.length > 1 ? ` · ещё ${found.length - 1}` : ''}` : `${a.title} · ${a.inBalance ? 'уже в бэкапе' : 'ещё не в бэкапе'}`,
      value: 'другое',
      href: sheetHref('arrived-pick'),
    }),
  );
  root.append(head);
  // сначала спросить: может, эти деньги уже распределены (D100)
  if (opId && !asked.has(opId)) {
    root.append(
      h(
        'div',
        { class: 'card stack' },
        h('strong', null, 'Помочь распределить эти деньги?'),
        h('p', { class: 'muted' }, 'Подскажу, сколько можно отложить на цели и сколько останется на жизнь. Если уже распределил сам — просто скажи.'),
        h('button', { class: 'btn primary wide', type: 'button', onclick: () => (asked.add(opId), rerender()) }, 'Да, посчитай'),
        h('button', { class: 'btn wide', type: 'button', onclick: () => void markHandled(opId, `${fmt(a.amount)} · ${a.title}`) }, 'Уже распределил'),
      ),
    );
    return root;
  }
  const sp = splitIncome(st, today(), a.amount, a.inBalance);
  if (sp.deficit > 0) {
    root.append(
      h(
        'div',
        { class: 'badline stack' },
        h('strong', null, `До ${fmtDay(sp.nextIncome)} не хватает ${fmt(sp.deficit)}`),
        h('div', null, 'Платежи и обычные траты до следующего дохода больше, чем есть денег. Откладывать не из чего.'),
        sp.compare.step0.options.length ? h('ul', null, sp.compare.step0.options.map((o) => h('li', null, o))) : null,
      ),
    );
  } else {
    root.append(adviceCard(sp, a));
  }
  if (opId) root.append(h('button', { class: 'btn link', type: 'button', onclick: () => void markHandled(opId, `${fmt(a.amount)} · ${a.title}`) }, 'Не надо — уже распределил'));
  root.append(rows(row({ title: 'Другие способы распределить', sub: 'быстрее к одной цели, больше в подушку', href: '#/income-more' })));
  return root;
}
