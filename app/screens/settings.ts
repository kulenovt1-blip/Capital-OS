/** Экран «Настройки»: счета и ликвидность, ручные счета, корректировки, обязательства, доходы, классификация, параметры, бэкап. */
import {
  CLASS_LABELS, DEFAULT_CLASSIFICATION, INCOME_KIND_HINTS, INCOME_KIND_LABELS, SAVINGS_FLOW_ACCOUNT_ID, buildOverview, classifyAll, emptyState, makeInstallment, makeRecurring,
  parseState, remainingFromLastDate, remainingFromTerm, serializeState, suggestionToObligation, validateAdjustment, validateClassification, validateObligation,
  type AccountSettings, type AppState, type IncomeKind, type InstallmentSuggestion, type Liquidity, type ManualAccount, type Obligation, type Overview, type RemainingResult, type Settings,
} from '../../engine/index';
import { confirmButton, download, field, h, section, table, toast } from '../dom';
import { getState, replaceState, today, update } from '../store';
import { anchor, errorsBox, fmt, fmtDate, guide, info, liquidityText, moneyInput, moneySpan, newId, readChecked, readMoney, readStr } from '../ui';
import { installBlock } from '../install';

function liquidityEditor(name: string, value: Liquidity): HTMLElement {
  const kind = h(
    'select',
    { name: `${name}-kind` },
    h('option', { value: 'instant', selected: value.kind === 'instant' }, 'сразу (карта, наличные)'),
    h('option', { value: 'days', selected: value.kind === 'days' }, 'снятие за N дней'),
    h('option', { value: 'locked_until', selected: value.kind === 'locked_until' }, 'заблокировано до даты'),
  );
  const days = h('input', { name: `${name}-days`, type: 'number', min: 0, step: 1, value: value.kind === 'days' ? value.days : 1, class: 'short' });
  const date = h('input', { name: `${name}-date`, type: 'date', value: value.kind === 'locked_until' ? value.date : today() });
  const sync = () => {
    days.hidden = kind.value !== 'days';
    date.hidden = kind.value !== 'locked_until';
  };
  kind.addEventListener('change', sync);
  sync();
  return h('span', { class: 'liq' }, kind, days, date);
}

function readLiquidity(form: HTMLFormElement, name: string): Liquidity {
  const k = readStr(form, `${name}-kind`);
  if (k === 'days') return { kind: 'days', days: Math.max(0, Math.floor(Number(readStr(form, `${name}-days`)) || 0)) };
  if (k === 'locked_until') return { kind: 'locked_until', date: readStr(form, `${name}-date`) || today() };
  return { kind: 'instant' };
}

function accountsSection(st: AppState): HTMLElement {
  const accs = (st.imported?.accounts ?? []).filter((a) => !a.removed).map((a) => ({ id: a.id, title: a.title, flagged: a.ignoreInBalance }));
  accs.push({ id: SAVINGS_FLOW_ACCOUNT_ID, title: 'Сбережения вне MoneyManager (оценка по переводам)', flagged: false });
  const byId = new Map(st.settings.accounts.map((s) => [s.accountId, s]));
  const goals = st.goals.filter((g) => g.status !== 'cancelled' && g.status !== 'done');
  const form = h('form', { class: 'stack' });
  form.append(
    table(
      ['Счёт', 'Исключить из анализа', 'Ликвидность', 'Весь остаток за целью'],
      accs.map((a) => {
        const s: AccountSettings = byId.get(a.id) ?? { accountId: a.id, excluded: false, liquidity: { kind: 'instant' } };
        return [
          h('span', null, a.title, a.flagged ? h('small', { class: 'muted' }, ' · в MM «не учитывать в балансе»') : null),
          h('input', { type: 'checkbox', name: `ex-${a.id}`, checked: s.excluded }),
          liquidityEditor(`lq-${a.id}`, s.liquidity),
          h('select', { name: `goal-${a.id}` }, h('option', { value: '' }, '— нет —'), goals.map((g) => h('option', { value: g.id, selected: g.id === s.boundGoalId }, g.title))),
        ];
      }),
    ),
    h('button', { class: 'btn primary', type: 'submit' }, 'Сохранить счета'),
  );
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const next: AccountSettings[] = accs.map((a) => {
      const goalId = readStr(form, `goal-${a.id}`);
      // сохранение — это ответ на вопрос о счёте, больше не спрашиваем
      return { accountId: a.id, excluded: readChecked(form, `ex-${a.id}`), liquidity: readLiquidity(form, `lq-${a.id}`), reviewed: true, ...(goalId ? { boundGoalId: goalId } : {}) };
    });
    await update((s) => ({ ...s, settings: { ...s.settings, accounts: next.sort((x, y) => (x.accountId < y.accountId ? -1 : 1)) } }));
    toast('Счета сохранены');
  });
  return section(
    h('span', null, 'Счета и ликвидность', info('liquid')),
    guide(
      'Все счета из MoneyManager: учитывать ли счёт, как быстро с него можно снять деньги и не отложен ли он целиком под цель.',
      'Один раз после первого импорта и когда открываешь новый счёт или депозит. Если все счета — обычные карты и наличные, менять ничего не нужно.',
    ),
    h('p', { class: 'muted' }, '«Исключить» — только для технических счетов: исключённый счёт виден, но не входит в капитал. Заначку не исключай: чтобы она не считалась «свободной», выбери цель в последней колонке — весь остаток счёта будет за ней и при пополнении тоже.', info('assigned')),
    form,
  );
}

function openingDebtsSection(st: AppState, o: Overview): HTMLElement {
  const d = st.settings.openingDebts;
  const negative = o.capital.explanation.filter((x) => x.code === 'capital.payables_negative' || x.code === 'capital.receivables_negative');
  const form = h(
    'form',
    { class: 'grid-form' },
    field('Мне были должны на начало учёта, ₸', moneyInput('rec', d.receivable)),
    field('Я был должен на начало учёта, ₸', moneyInput('pay', d.payable)),
    h('button', { class: 'btn primary', type: 'submit' }, 'Сохранить суммы'),
  );
  const err = h('div');
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const receivable = readMoney(form, 'rec');
    const payable = readMoney(form, 'pay');
    if (receivable === null || payable === null || receivable < 0 || payable < 0) return err.replaceChildren(errorsBox(['Введи неотрицательные суммы (0, если долга не было)']) ?? '');
    await update((s) => ({ ...s, settings: { ...s.settings, openingDebts: { receivable, payable } } }));
    toast('Долги на начало учёта сохранены');
  });
  const setAck = (v: boolean) => update((s) => ({ ...s, settings: { ...s.settings, openingDebts: { ...s.settings.openingDebts, acknowledged: v } } }));
  return section(
    h('span', null, 'Долги на начало учёта', info('openingDebts')),
    guide(
      'Долги, которые появились до первой операции в твоём бэкапе. В данных есть только их возврат, поэтому долг выходит «отрицательным».',
      'Только если приложение об этом просит. Сумму можно не знать: «Не знаю — считать 0» закрывает вопрос, на расчёты это не влияет — отрицательный долг и так считается нулём. Текущие долги сюда не пиши: веди их в MoneyManager категориями, размеченными как «Выдал в долг» / «Мне вернули долг» / «Взял в долг» / «Вернул долг», — приложение посчитает их само.',
    ),
    negative.length ? h('ul', { class: 'plain muted' }, negative.map((x) => h('li', null, x.text))) : null,
    negative.length && !d.acknowledged
      ? h('div', { class: 'row' }, h('button', { class: 'btn primary', type: 'button', onclick: () => setAck(true).then(() => toast('Принято: сумма неизвестна, считается 0')) }, 'Не знаю — считать 0'))
      : d.acknowledged
        ? h('div', { class: 'row' }, h('span', { class: 'muted' }, 'Принято: сумма неизвестна, считается 0.'), h('button', { class: 'btn small', type: 'button', onclick: () => setAck(false) }, 'Отменить'))
        : null,
    h('details', { class: 'add', 'data-key': 'debts:amounts' }, h('summary', null, 'Я знаю суммы'), form, err),
  );
}

function savingsFlowsSection(st: AppState): HTMLElement | null {
  const sf = st.settings.savingsFlows;
  // какие категории размечены как «перевод на сбережения вне приложения» — по разметке пользователя, без зашитых названий (D72)
  const cats = new Map<string, number>();
  if (st.imported) {
    const labels = new Map(st.imported.categories.map((c) => [c.id, st.settings.categoryLabels[c.id] || c.label || c.title || c.id]));
    for (const c of classifyAll(st.imported, st.settings.classification).ops) {
      if (c.cls !== 'T_savings_out' || c.op.kind === 'transfer') continue;
      const l = c.op.categoryId ? labels.get(c.op.categoryId) ?? c.op.categoryId : 'без категории';
      cats.set(l, (cats.get(l) ?? 0) + 1);
    }
  }
  if (!cats.size && sf.mode === 'estimate' && !st.manualAccounts.some((m) => m.receivesSavingsFlows)) return null;
  const opt = (v: string, label: string, hint: string) =>
    h('label', { class: 'check radio-line' }, h('input', { type: 'radio', name: 'mode', value: v, checked: sf.mode === v }), h('span', null, h('strong', null, label), h('br'), h('small', { class: 'muted' }, hint)));
  const form = h(
    'form',
    { class: 'stack' },
    opt('estimate', 'Оценивать по сумме переводов', 'деньги лежат на счёте, которого нет в MoneyManager; приложение сложит переводы (без процентов)'),
    opt('manual', 'Прибавлять к ручному счёту', 'у тебя заведён ручной счёт с реальным остатком; переводы после даты остатка прибавятся к нему'),
    st.manualAccounts.length ? field('Ручной счёт', h('select', { name: 'manual' }, st.manualAccounts.map((m) => h('option', { value: m.id, selected: sf.mode === 'manual' && sf.manualAccountId === m.id }, m.title)))) : h('small', { class: 'muted' }, 'Ручных счетов пока нет — их можно завести в «Редко нужно → Ручные счета».'),
    opt('ignore', 'Уже учтены в балансах счетов', 'деньги потом вернулись в MoneyManager — например, ты завёл счёт накоплений с начальным остатком; иначе одни и те же деньги посчитаются дважды'),
    h('button', { class: 'btn primary', type: 'submit' }, 'Сохранить'),
  );
  const err = h('div');
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const mode = (form.querySelector('input[name="mode"]:checked') as HTMLInputElement | null)?.value;
    let next: AppState['settings']['savingsFlows'];
    if (mode === 'manual') {
      const id = readStr(form, 'manual');
      if (!id) return err.replaceChildren(errorsBox(['Сначала заведи ручной счёт']) ?? '');
      next = { mode: 'manual', manualAccountId: id };
    } else next = { mode: mode === 'ignore' ? 'ignore' : 'estimate' };
    // выбор сделан явно — шаг настройки закрыт, даже если оставлена оценка
    next = { ...next, confirmed: true };
    await update((s) => ({ ...s, settings: { ...s.settings, savingsFlows: next } }));
    toast('Сохранено');
  });
  const list = [...cats.entries()].map(([l, n]) => `«${l}» (${n})`).join(', ');
  return section(
    h('span', null, 'Куда уходили переводы на сбережения', info('savingsFlow')),
    guide(
      `Расходы с классом «${CLASS_LABELS.T_savings_out}»${list ? ` — у тебя это ${list}` : ''}. Это не траты: деньги ушли на счёт, которого нет в MoneyManager. Приложению нужно знать, где они сейчас.`,
      'Один раз. Если не уверен — оставь оценку и нажми «Сохранить». Какие категории сюда попадают, решает разметка на экране «Классы».',
    ),
    form,
    err,
  );
}

function manualAccountsSection(st: AppState): HTMLElement {
  const form = h(
    'form',
    { class: 'grid-form' },
    field('Название', h('input', { name: 'title', required: true, placeholder: 'Депозит в Halyk' })),
    field('Остаток, ₸', moneyInput('balance')),
    field('На дату', h('input', { name: 'date', type: 'date', value: today() })),
    field('Ликвидность', liquidityEditor('lq', { kind: 'instant' })),
    field('Ставка, % годовых', h('input', { name: 'rate', inputmode: 'decimal', placeholder: 'пусто — без процентов' }), 'используется в прогнозе (этап 3)'),
    field('Капитализация', h('select', { name: 'cap' }, h('option', { value: 'monthly' }, 'ежемесячная'), h('option', { value: 'daily' }, 'ежедневная'))),
    field('Комментарий', h('input', { name: 'comment' })),
    h('button', { class: 'btn primary', type: 'submit' }, 'Добавить счёт'),
  );
  const errBox = h('div');
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const errs: string[] = [];
    const title = readStr(form, 'title');
    const balance = readMoney(form, 'balance');
    const rateStr = readStr(form, 'rate').replace(',', '.');
    let rateBp: number | null = null;
    if (rateStr) {
      const m = /^(\d{1,3})(?:\.(\d{1,2}))?$/.exec(rateStr);
      if (!m) errs.push('Ставка: число с точностью до сотых, например 14.5');
      else rateBp = Number(m[1]) * 100 + Number((m[2] ?? '').padEnd(2, '0') || 0);
    }
    if (!title) errs.push('Нужно название');
    if (balance === null) errs.push('Остаток: введи сумму в тенге');
    errBox.replaceChildren(errorsBox(errs) ?? '');
    if (errs.length) return;
    const acc: ManualAccount = {
      id: newId('man'),
      title,
      balance: balance!,
      balanceDate: readStr(form, 'date') || today(),
      liquidity: readLiquidity(form, 'lq'),
      comment: readStr(form, 'comment'),
      ...(rateBp !== null ? { deposit: { rateBp, capitalization: readStr(form, 'cap') as 'monthly' | 'daily' } } : {}),
    };
    await update((s) => ({ ...s, manualAccounts: [...s.manualAccounts, acc] }));
    toast('Счёт добавлен');
  });
  return section(
    'Ручные счета',
    guide('Счёт, которого нет в MoneyManager: депозит в другом банке, деньги у родителей. Задаётся остатком на дату.', 'Только если такие деньги есть и заводить их в MoneyManager ты не хочешь.'),
    st.manualAccounts.length
      ? table(
          ['Счёт', 'Остаток', 'Доступ', 'Ставка', ''],
          st.manualAccounts.map((m) => [
            h('span', null, m.title, m.receivesSavingsFlows ? h('small', { class: 'muted' }, ' · принимает сбережения') : null),
            h('span', null, moneySpan(m.balance), h('small', { class: 'muted' }, ` на ${fmtDate(m.balanceDate)}`)),
            liquidityText(m.liquidity),
            m.deposit ? `${(m.deposit.rateBp / 100).toFixed(2)}%` : '—',
            confirmButton('Удалить', 'Точно удалить?', () => update((s) => ({ ...s, manualAccounts: s.manualAccounts.filter((x) => x.id !== m.id) }))),
          ]),
        )
      : null,
    h('details', { class: 'add' }, h('summary', null, '+ Добавить ручной счёт'), form, errBox),
  );
}

function adjustmentsSection(st: AppState): HTMLElement {
  const accs = [...(st.imported?.accounts ?? []).filter((a) => !a.removed), ...st.manualAccounts.map((m) => ({ id: m.id, title: m.title }))];
  const form = h(
    'form',
    { class: 'grid-form' },
    field('Счёт', h('select', { name: 'acc' }, accs.map((a) => h('option', { value: a.id }, a.title)))),
    field('Сумма, ₸ (минус — уменьшить)', moneyInput('amount')),
    field('Дата', h('input', { name: 'date', type: 'date', value: today() })),
    field('Причина (обязательно)', h('input', { name: 'comment', required: true })),
    h('button', { class: 'btn primary', type: 'submit' }, 'Добавить корректировку'),
  );
  const errBox = h('div');
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const amount = readMoney(form, 'amount');
    const adj = { id: newId('adj'), accountId: readStr(form, 'acc'), date: readStr(form, 'date') || today(), amount: amount ?? (0 as never), comment: readStr(form, 'comment') };
    const errs = amount === null ? ['Введи сумму'] : validateAdjustment(adj);
    errBox.replaceChildren(errorsBox(errs) ?? '');
    if (errs.length) return;
    await update((s) => ({ ...s, adjustments: [...s.adjustments, adj] }));
    toast('Корректировка добавлена');
  });
  const title = (id: string) => accs.find((a) => a.id === id)?.title ?? id;
  return section(
    'Корректировки',
    guide('Разовая поправка баланса с причиной — когда в MoneyManager что-то не внесено. В сверку импорта не входит, в капитал входит.', 'Редко: лучше внести операцию в MoneyManager. Корректировка — когда там исправить нельзя.'),
    st.adjustments.length
      ? table(
          ['Дата', 'Счёт', 'Сумма', 'Причина', ''],
          st.adjustments.map((a) => [fmtDate(a.date), title(a.accountId), moneySpan(a.amount, { sign: true }), a.comment, confirmButton('Удалить', 'Точно?', () => update((s) => ({ ...s, adjustments: s.adjustments.filter((x) => x.id !== a.id) })))]),
        )
      : null,
    h('details', { class: 'add' }, h('summary', null, '+ Добавить корректировку'), form, errBox),
  );
}

function obligationsSection(st: AppState, o: Overview): HTMLElement {
  const tagNames = (st.imported?.tags ?? []).map((t) => t.name);
  const form = h(
    'form',
    { class: 'grid-form' },
    field('Вид', h('select', { name: 'kind' }, h('option', { value: 'installment' }, 'рассрочка'), h('option', { value: 'debt' }, 'долг (нет в MoneyManager)'), h('option', { value: 'recurring' }, 'регулярный платёж'))),
    field('Название', h('input', { name: 'title', required: true, placeholder: 'Рассрочка телефон' })),
    field('Чья', h('select', { name: 'owner' }, h('option', { value: 'self' }, 'моя'), h('option', { value: 'family' }, 'семейная'))),
    field('Остаток, ₸', moneyInput('remaining'), 'для регулярного платежа не нужен'),
    field('Остаток на дату', h('input', { name: 'asOf', type: 'date', value: today() }), 'платежи после этой даты уменьшат остаток'),
    field('Платёж, ₸', moneyInput('payment')),
    field('Дата ближайшего платежа', h('input', { name: 'first', type: 'date', value: today() })),
    field('Месяцев (для регулярного)', h('input', { name: 'months', type: 'number', min: 1, value: 12, class: 'short' })),
    field('Платежи в MoneyManager с тегом', h('input', { name: 'tag', list: 'tag-list', placeholder: 'например, телефон' }), 'по нему фактические платежи находятся автоматически'),
    field('…или с текстом в комментарии', h('input', { name: 'comment' })),
    h('datalist', { id: 'tag-list' }, tagNames.map((t) => h('option', { value: t }))),
    h('button', { class: 'btn primary', type: 'submit' }, 'Добавить'),
  );
  const errBox = h('div');
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const kind = readStr(form, 'kind') as Obligation['kind'];
    const payment = readMoney(form, 'payment');
    const remaining = readMoney(form, 'remaining');
    const tag = readStr(form, 'tag');
    const comment = readStr(form, 'comment');
    const match = tag || comment ? { ...(tag ? { tags: [tag] } : {}), ...(comment ? { commentContains: comment } : {}) } : undefined;
    const errs: string[] = [];
    if (payment === null || payment <= 0) errs.push('Платёж должен быть больше нуля');
    if (kind !== 'recurring' && (remaining === null || remaining <= 0)) errs.push('Укажи остаток');
    let ob: Obligation | null = null;
    if (!errs.length) {
      try {
        const base = { id: newId('ob'), title: readStr(form, 'title'), owner: readStr(form, 'owner') as 'self' | 'family', firstDate: readStr(form, 'first') || today(), ...(match ? { match } : {}) };
        ob =
          kind === 'recurring'
            ? makeRecurring({ ...base, amount: payment!, months: Math.max(1, Math.floor(Number(readStr(form, 'months')) || 1)) })
            : makeInstallment({ ...base, kind, remaining: remaining!, remainingAsOf: readStr(form, 'asOf') || today(), payment: payment! });
        errs.push(...validateObligation(ob));
      } catch (er) {
        errs.push(er instanceof Error ? er.message : String(er));
      }
    }
    errBox.replaceChildren(errorsBox(errs) ?? '');
    if (errs.length || !ob) return;
    const created = ob;
    await update((s) => ({ ...s, obligations: [...s.obligations, created] }));
    toast('Обязательство добавлено');
  });
  return section(
    'Обязательства',
    guide(
      'Рассрочки, долги вне MoneyManager и регулярные платежи. «Свободно» вычитает платежи до следующего дохода, капитал — остаток долга, прогноз — все будущие платежи.',
      'Если платишь рассрочку — да. Рассрочки из операций приложение находит само (блок ниже): останется указать срок или остаток. Вручную — только долги, которых нет в MoneyManager.',
    ),
    suggestionsBlock(st, o),
    checksBlock(st, o),
    st.obligations.length
      ? table(
          ['Название', 'Вид', 'Остаток', 'Платёж', 'Платежей', ''],
          st.obligations.map((o) => [
            `${o.title}${o.owner === 'family' ? ' (семья)' : ''}`,
            o.kind === 'installment' ? 'рассрочка' : o.kind === 'debt' ? 'долг' : 'регулярный',
            o.kind === 'recurring' ? '—' : h('span', null, moneySpan(o.remaining), h('small', { class: 'muted' }, ` на ${fmtDate(o.remainingAsOf)}`)),
            o.schedule[0] ? fmt(o.schedule[0].amount) : '—',
            String(o.schedule.length),
            confirmButton('Удалить', 'Точно удалить?', () => update((s) => ({ ...s, obligations: s.obligations.filter((x) => x.id !== o.id) }))),
          ]),
        )
      : null,
    h('details', { class: 'add' }, h('summary', null, '+ Добавить вручную'), h('p', { class: 'muted' }, 'Платежи из MoneyManager сопоставляются с графиком по тегу или комментарию (окно ±' + st.settings.matchWindowDays + ' дн.).'), form, errBox),
  );
}

/** Находки автозаполнения: карточка на каждую рассрочку из операций (D67). */
function suggestionsBlock(st: AppState, o: Overview): HTMLElement | null {
  const list = o.installments.suggestions;
  if (!list.length) return null;
  return h(
    'div',
    { class: 'stack suggest-list' },
    h('h3', null, `Найдено в операциях: ${list.length}`, info('installmentDetect')),
    ...list.map((s) => suggestionCard(st, s)),
  );
}

function suggestionCard(st: AppState, s: InstallmentSuggestion): HTMLElement {
  const method = h(
    'select',
    { name: 'method' },
    h('option', { value: 'term', disabled: !s.uniform, selected: s.uniform }, 'знаю срок рассрочки'),
    h('option', { value: 'remaining', selected: !s.uniform }, 'знаю остаток'),
    h('option', { value: 'last' }, 'знаю дату последнего платежа'),
  );
  const term = h('input', { name: 'term', type: 'number', min: 1, max: 120, placeholder: '12', class: 'short' });
  const paid = h('input', { name: 'paid', type: 'number', min: 0, value: s.count, class: 'short' });
  const remaining = moneyInput('remaining');
  const last = h('input', { name: 'last', type: 'date' });
  const title = h('input', { name: 'title', value: s.title });
  const owner = h('select', { name: 'owner' }, h('option', { value: 'self', selected: s.owner === 'self' }, 'моя'), h('option', { value: 'family', selected: s.owner === 'family' }, 'семейная'));
  const fTerm = h('div', { class: 'grid-form' }, field('Рассрочка на, мес.', term), field('Сделано платежей', paid, s.mayPredateData ? `в данных ${s.count}; если рассрочка началась раньше бэкапа — укажи настоящее число` : `в данных ${s.count}`));
  const fRem = h('div', { class: 'grid-form' }, field('Осталось выплатить, ₸', remaining, 'например, из приложения банка'));
  const fLast = h('div', { class: 'grid-form' }, field('Последний платёж', last));
  const preview = h('p', { class: 'muted' });
  const err = h('div');
  const compute = (): RemainingResult | null => {
    if (method.value === 'term') {
      if (!term.value) return null;
      return remainingFromTerm(s, Math.floor(Number(term.value)), Math.max(0, Math.floor(Number(paid.value) || 0)));
    }
    if (method.value === 'last') return last.value ? remainingFromLastDate(s, last.value) : null;
    const form = remaining.closest('form') as HTMLFormElement | null;
    const r = form ? readMoney(form, 'remaining') : null;
    return r === null ? null : r > 0 ? { ok: true, remaining: r, paymentsLeft: Math.ceil(r / s.payment), lastDate: s.nextDate } : { ok: false, error: 'Остаток должен быть больше нуля' };
  };
  const sync = () => {
    fTerm.hidden = method.value !== 'term';
    fRem.hidden = method.value !== 'remaining';
    fLast.hidden = method.value !== 'last';
    const r = compute();
    preview.replaceChildren(
      !r ? 'Укажи данные — здесь появится остаток.' : r.ok ? (method.value === 'remaining' ? `Остаток ${fmt(r.remaining)} — это около ${r.paymentsLeft} платежей по ${fmt(s.payment)}` : `Осталось ${r.paymentsLeft} ${r.paymentsLeft === 1 ? 'платёж' : r.paymentsLeft < 5 ? 'платежа' : 'платежей'} = ${fmt(r.remaining)}, последний ${fmtDate(r.lastDate)}`) : h('span', { class: 'bad' }, r.error),
    );
  };
  const form = h(
    'form',
    { class: 'stack' },
    field('Как посчитать остаток', method),
    fTerm,
    fRem,
    fLast,
    preview,
    h('div', { class: 'grid-form' }, field('Название', title), field('Чья', owner)),
    h('div', { class: 'row' }, h('button', { class: 'btn primary', type: 'submit' }, 'Завести'), h('button', { class: 'btn', type: 'button', onclick: () => dismiss(s.key).then(() => toast('Скрыто — больше не предложится')) }, 'Это не рассрочка')),
    err,
  );
  form.addEventListener('input', sync);
  form.addEventListener('change', sync);
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const r = compute();
    if (!r || !r.ok) return err.replaceChildren(errorsBox([r ? r.error : 'Укажи срок, остаток или дату последнего платежа']) ?? '');
    const ob = suggestionToObligation(s, { id: newId('ob'), remaining: r.remaining, today: today(), title: title.value, owner: owner.value as 'self' | 'family' });
    const errs = validateObligation(ob);
    if (errs.length) return err.replaceChildren(errorsBox(errs) ?? '');
    await update((x) => ({ ...x, obligations: [...x.obligations, ob] }));
    toast(`«${ob.title}» заведена`);
  });
  sync();
  // уже заведена вручную — связать, чтобы её платежи находились
  const linkable = st.obligations.filter((x) => x.kind === 'installment');
  const linkSel = h('select', null, linkable.map((x) => h('option', { value: x.id }, x.title)));
  const link = linkable.length
    ? h(
        'details',
        { class: 'add', 'data-key': `suggest:${s.key}:link` },
        h('summary', null, 'Уже заведена вручную'),
        h('p', { class: 'muted' }, 'Выбери её — платежи этой находки будут находиться по ней.'),
        h('div', { class: 'row' }, linkSel, h('button', { class: 'btn', type: 'button', onclick: () => update((x) => ({ ...x, obligations: x.obligations.map((y) => (y.id === linkSel.value ? { ...y, match: s.match } : y)) })).then(() => toast('Связано')) }, 'Связать')),
      )
    : null;
  return h(
    'div',
    { class: 'suggest' },
    h('div', { class: 'goal-head' }, h('strong', null, s.title), s.owner === 'family' ? h('span', { class: 'badge' }, 'семья') : null),
    h('p', null, `${s.count} ${s.count === 1 ? 'платёж' : s.count < 5 ? 'платежа' : 'платежей'} по ${fmt(s.payment)}, около ${s.dayOfMonth}-го числа · последний ${fmtDate(s.lastDate)} · следующий ${fmtDate(s.nextDate)}`),
    s.warnings.length ? h('ul', { class: 'plain warn-list' }, s.warnings.map((w) => h('li', null, w))) : null,
    form,
    link,
  );
}

const dismiss = (key: string) => update((x) => ({ ...x, settings: { ...x.settings, dismissedInstallments: [...new Set([...x.settings.dismissedInstallments, key])].sort() } }));

/** Расхождения заведённых рассрочек с операциями — с кнопкой исправления. */
function checksBlock(st: AppState, o: Overview): HTMLElement | null {
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
            class: 'btn small',
            type: 'button',
            onclick: async () => {
              const next = status.effectiveUpcoming[0]?.date ?? today();
              const upd = makeInstallment({ id: ob.id, title: ob.title, owner: ob.owner, kind: 'installment', remaining: status.remainingNow, remainingAsOf: today(), payment: amount, firstDate: next > today() ? next : today(), ...(ob.match ? { match: ob.match } : {}), interestRateBp: ob.interestRateBp, earlyPayoffAllowed: ob.earlyPayoffAllowed });
              await update((x) => ({ ...x, obligations: x.obligations.map((y) => (y.id === ob.id ? upd : y)) }));
              toast('График обновлён');
            },
          },
          `Обновить платёж на ${fmt(amount)}`,
        );
      } else if (ob && c.kind === 'stalled') {
        fix = confirmButton('Закрыта — удалить', 'Точно удалить?', () => update((x) => ({ ...x, obligations: x.obligations.filter((y) => y.id !== ob.id) })).then(() => toast('Обязательство удалено')));
      }
      return h('div', { class: 'notice warn with-action' }, h('span', null, c.text), fix);
    }),
  );
}

function incomeSection(st: AppState): HTMLElement {
  const KINDS: IncomeKind[] = ['work', 'stable', 'irregular'];
  const kindSel = h('select', { name: 'kind' }, KINDS.map((k) => h('option', { value: k }, INCOME_KIND_LABELS[k])));
  const kindHint = h('small', { class: 'muted' }, INCOME_KIND_HINTS.work);
  kindSel.addEventListener('change', () => (kindHint.textContent = INCOME_KIND_HINTS[kindSel.value as IncomeKind]));
  const form = h(
    'form',
    { class: 'grid-form' },
    field('Источник', h('input', { name: 'title', required: true, placeholder: 'Зарплата' })),
    field('День месяца', h('input', { name: 'day', type: 'number', min: 1, max: 31, value: 5, class: 'short' })),
    field(h('span', null, 'Вид', info('incomeKind')), h('div', { class: 'stack' }, kindSel, kindHint)),
    field('Ожидаемая сумма, ₸', moneyInput('amount'), 'для нерегулярного — средняя за месяц; если не уверен — примерная'),
    field('С даты (необязательно)', h('input', { name: 'start', type: 'date' })),
    field('По дату (необязательно)', h('input', { name: 'end', type: 'date' })),
    h('button', { class: 'btn primary', type: 'submit' }, 'Добавить доход'),
  );
  const errBox = h('div');
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const amount = readMoney(form, 'amount');
    const dayN = Math.floor(Number(readStr(form, 'day')));
    const errs: string[] = [];
    if (!readStr(form, 'title')) errs.push('Нужно название');
    if (!(dayN >= 1 && dayN <= 31)) errs.push('День месяца — от 1 до 31');
    if (amount === null || amount <= 0) errs.push('Сумма должна быть больше нуля');
    errBox.replaceChildren(errorsBox(errs) ?? '');
    if (errs.length) return;
    const start = readStr(form, 'start');
    const end = readStr(form, 'end');
    const item = { id: newId('inc'), title: readStr(form, 'title'), dayOfMonth: dayN, amount: amount!, kind: readStr(form, 'kind') as IncomeKind, ...(start ? { start } : {}), ...(end ? { end } : {}) };
    await update((s) => ({ ...s, settings: { ...s.settings, incomeSchedule: [...s.settings.incomeSchedule, item] } }));
    toast('Доход добавлен');
  });
  return section(
    'Расписание доходов',
    guide(
      `Когда и сколько денег приходит. Отсюда «Свободно» знает, сколько дней до следующего дохода (без расписания — условно ${st.settings.defaultIncomeHorizonDays} дней), а прогноз — будущие поступления.`,
      'Да, хотя бы основной доход. Вид дохода решает, как он поведёт себя в неблагоприятном сценарии; доход, который закончится (стипендия до выпуска), — с датой окончания.',
    ),
    st.settings.incomeSchedule.length
      ? table(
          ['Источник', 'День', 'Сумма', 'Период', ''],
          st.settings.incomeSchedule.map((x) => [
            h('span', null, x.title, h('small', { class: 'muted' }, ` · ${INCOME_KIND_LABELS[x.kind ?? 'stable']}`)),
            String(x.dayOfMonth),
            fmt(x.amount),
            `${x.start ? 'с ' + fmtDate(x.start) : ''} ${x.end ? 'по ' + fmtDate(x.end) : ''}`.trim() || 'бессрочно',
            confirmButton('Удалить', 'Точно?', () => update((s) => ({ ...s, settings: { ...s.settings, incomeSchedule: s.settings.incomeSchedule.filter((y) => y.id !== x.id) } }))),
          ]),
        )
      : null,
    h('details', { class: 'add' }, h('summary', null, '+ Добавить доход'), form, errBox),
  );
}

function classificationSection(st: AppState): HTMLElement {
  const fam = h('input', { name: 'family', value: st.settings.classification.familyTags.join(', '), placeholder: 'мама, папа' });
  const ta = h('textarea', { name: 'rules', rows: 12, spellcheck: 'false', class: 'mono' });
  ta.value = JSON.stringify(st.settings.classification.rules, null, 2);
  const errBox = h('div');
  const form = h(
    'form',
    { class: 'stack' },
    field('«Семейные» теги для рассрочек', fam, 'рассрочка с таким тегом получает класс E_installment_family'),
    field('Правила «категория → класс» (JSON)', ta, 'порядок важен: правило по uid категории сильнее правила по названию'),
    h('div', { class: 'row' }, h('button', { class: 'btn primary', type: 'submit' }, 'Сохранить правила'), confirmButton('Сбросить к правилам по умолчанию', 'Точно сбросить?', () => update((s) => ({ ...s, settings: { ...s.settings, classification: structuredClone(DEFAULT_CLASSIFICATION) } })), '')),
  );
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    let rules: unknown;
    try {
      rules = JSON.parse(ta.value);
    } catch {
      errBox.replaceChildren(errorsBox(['Правила — некорректный JSON']) ?? '');
      return;
    }
    const familyTags = fam.value.split(',').map((t) => t.trim()).filter(Boolean);
    const v = validateClassification({ rules, familyTags }, st.settings.classes.custom.map((c) => c.id));
    errBox.replaceChildren(errorsBox(v.errors) ?? '');
    if (!v.ok) return;
    await update((s) => ({ ...s, settings: { ...s.settings, classification: v.value } }));
    toast('Правила сохранены');
  });
  return section(
    'Классификация',
    guide('Правила, по которым категории MoneyManager попадают в классы, и теги, делающие рассрочку семейной.', 'Обычно нет: категории размечаются на экране «Классы», правила там пишутся сами. Здесь — семейные теги, тонкая настройка и сброс.'),
    form,
    errBox,
  );
}

function paramsSection(st: AppState): HTMLElement {
  const s = st.settings;
  const num = (name: keyof Settings, v: number, min = 0) => h('input', { name, type: 'number', min, step: 1, value: v, class: 'short' });
  const form = h(
    'form',
    { class: 'grid-form' },
    field('Минимальный резерв, мес. базовых расходов', num('reserveMonths', s.reserveMonths, 1)),
    field('Медиана расходов — за сколько полных месяцев', num('baselineMonths', s.baselineMonths, 1)),
    field('Горизонт без расписания доходов, дней', num('defaultIncomeHorizonDays', s.defaultIncomeHorizonDays, 1)),
    field('Окно сопоставления платежей, дней', num('matchWindowDays', s.matchWindowDays)),
    field('Инфляция, % годовых', h('input', { name: 'inflation', inputmode: 'decimal', value: (s.inflationBp / 100).toFixed(2), class: 'short' })),
    h('button', { class: 'btn primary', type: 'submit' }, 'Сохранить параметры'),
  );
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const n = (k: string, min: number) => Math.max(min, Math.floor(Number(readStr(form, k)) || min));
    const infl = Math.round(Number(readStr(form, 'inflation').replace(',', '.')) * 100);
    await update((x) => ({
      ...x,
      settings: {
        ...x.settings,
        reserveMonths: n('reserveMonths', 1),
        baselineMonths: n('baselineMonths', 1),
        defaultIncomeHorizonDays: n('defaultIncomeHorizonDays', 1),
        matchWindowDays: n('matchWindowDays', 0),
        inflationBp: Number.isSafeInteger(infl) && infl >= 0 ? infl : x.settings.inflationBp,
      },
    }));
    toast('Параметры сохранены');
  });
  return section(
    'Параметры расчёта',
    guide('Числа, на которых держатся расчёты: размер резерва, за сколько месяцев считать типичные расходы, инфляция.', 'Только если хочешь другой размер подушки (например, 6 месяцев вместо 3) или прогноз с другой инфляцией.'),
    form,
  );
}

function strategySection(st: AppState): HTMLElement {
  const s = st.settings.strategy;
  const pct = (bp: number) => (bp / 100).toFixed(2).replace(/\.00$/, '');
  const form = h(
    'form',
    { class: 'grid-form' },
    field('Стратегия текущего плана', h('select', { name: 'plan' }, (['A', 'B', 'C'] as const).map((id) => h('option', { value: id, selected: st.settings.planStrategy === id }, { A: 'A — Безопасность', B: 'B — Баланс', C: 'C — Ускорение' }[id]))), 'ей распределяется прирост в прогнозе и от неё считаются сдвиги'),
    field('Горизонт прогноза, мес.', h('input', { name: 'months', type: 'number', min: 6, max: 120, value: st.settings.simulationMonths, class: 'short' })),
    field('A: комфортный резерв, % от минимума', h('input', { name: 'comfort', inputmode: 'decimal', value: pct(s.comfortReserveBp), class: 'short' })),
    field('A: доля остатка в резерв, %', h('input', { name: 'cushion', inputmode: 'decimal', value: pct(s.cushionShareBp), class: 'short' })),
    field('Срочность: горизонт U, мес. (urgency = 1 + max(0, U − мес.)/U)', h('input', { name: 'urgency', type: 'number', min: 1, value: s.urgencyMonths, class: 'short' })),
    field('Округление минимума вверх до, ₸', moneyInput('step', s.requiredStep)),
    field('Объединять стратегии при разнице меньше, ₸', moneyInput('merge', s.mergeTolerance)),
    h('button', { class: 'btn primary', type: 'submit' }, 'Сохранить'),
  );
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const bp = (k: string, d: number) => {
      const v = Math.round(Number(readStr(form, k).replace(',', '.')) * 100);
      return Number.isSafeInteger(v) && v >= 0 ? v : d;
    };
    await update((x) => ({
      ...x,
      settings: {
        ...x.settings,
        planStrategy: readStr(form, 'plan') as 'A' | 'B' | 'C',
        simulationMonths: Math.min(120, Math.max(6, Math.floor(Number(readStr(form, 'months')) || 36))),
        strategy: {
          comfortReserveBp: bp('comfort', s.comfortReserveBp),
          cushionShareBp: Math.min(10000, bp('cushion', s.cushionShareBp)),
          urgencyMonths: Math.max(1, Math.floor(Number(readStr(form, 'urgency')) || s.urgencyMonths)),
          requiredStep: readMoney(form, 'step') ?? s.requiredStep,
          mergeTolerance: readMoney(form, 'merge') ?? s.mergeTolerance,
        },
      },
    }));
    toast('Коэффициенты сохранены');
  });
  return section(
    'Стратегии распределения',
    guide('Коэффициенты, по которым стратегии A–C делят поступление и строят прогноз.', 'Почти никогда. Стратегию выбираешь при каждом поступлении на экране «Поступление»; здесь — только какая из них считается «текущим планом» в прогнозе.'),
    form,
  );
}

function scenariosSection(st: AppState): HTMLElement {
  const pct = (bp: number | undefined) => (bp === undefined ? '' : (bp / 100).toString());
  const blocks = st.settings.scenarios.filter((sc) => sc.id !== 'base').map((sc) => {
    const p = sc.patch;
    const form = h(
      'form',
      { class: 'grid-form' },
      field('Доход «работа», % от плана', h('input', { name: 'work', inputmode: 'decimal', value: pct(p.workIncomeFactorBp), class: 'short', placeholder: '100' })),
      field('Нерегулярный доход, % от плана', h('input', { name: 'irregular', inputmode: 'decimal', value: pct(p.irregularIncomeFactorBp), class: 'short', placeholder: '100' })),
      field('Ещё не начавшаяся работа — позже на, мес.', h('input', { name: 'delay', type: 'number', min: 0, value: p.workDelayMonths ?? 0, class: 'short' })),
      field('Расходы, % от медианы', h('input', { name: 'exp', inputmode: 'decimal', value: pct(p.expenseFactorBp), class: 'short', placeholder: '100' })),
      field('Разовый расход, % месяца базовых', h('input', { name: 'oneoff', inputmode: 'decimal', value: pct(p.oneOffMonthsOfBaseBp), class: 'short', placeholder: '0' })),
      field('…в каком месяце от текущего', h('input', { name: 'offset', type: 'number', min: 0, value: p.oneOffMonthOffset ?? 1, class: 'short' })),
      h('button', { class: 'btn', type: 'submit' }, `Сохранить «${sc.name}»`),
    );
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const bp = (k: string) => {
        const t = readStr(form, k);
        if (!t) return undefined;
        const v = Math.round(Number(t.replace(',', '.')) * 100);
        return Number.isSafeInteger(v) && v >= 0 ? v : undefined;
      };
      const patch = { workIncomeFactorBp: bp('work'), irregularIncomeFactorBp: bp('irregular'), workDelayMonths: Math.max(0, Math.floor(Number(readStr(form, 'delay')) || 0)) || undefined, expenseFactorBp: bp('exp'), oneOffMonthsOfBaseBp: bp('oneoff'), oneOffMonthOffset: Math.max(0, Math.floor(Number(readStr(form, 'offset')) || 0)) };
      const clean = Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined));
      await update((x) => ({ ...x, settings: { ...x.settings, scenarios: x.settings.scenarios.map((y) => (y.id === sc.id ? { ...y, patch: clean } : y)) } }));
      toast('Сценарий сохранён');
    });
    return h('details', { class: 'add', 'data-key': `scenario:${sc.id}` }, h('summary', null, sc.name), form);
  });
  return section(
    h('span', null, 'Сценарии прогноза', info('scenarios')),
    guide('Насколько хуже или лучше базового плана считаются неблагоприятный и благоприятный прогнозы: доход, расходы, внезапная трата.', 'Только если считаешь значения по умолчанию слишком мягкими или жёсткими для своей жизни.'),
    ...blocks,
  );
}

function backupSection(): HTMLElement {
  const input = h('input', { type: 'file', accept: '.json,application/json' });
  const errBox = h('div');
  input.addEventListener('change', async () => {
    const f = input.files?.[0];
    if (!f) return;
    const r = parseState(await f.text());
    if (!r.ok) {
      errBox.replaceChildren(errorsBox([r.error]) ?? '');
      return;
    }
    await replaceState(r.value);
    toast('Бэкап восстановлен');
  });
  return section(
    'Бэкап приложения',
    guide('Все данные приложения — настройки, цели, разметка — лежат только в этом браузере. Бэкап — один JSON-файл с ними.', 'Да: раз в месяц и перед каждым обновлением приложения. Без бэкапа данные пропадут при очистке браузера.'),
    h(
      'div',
      { class: 'row' },
      h(
        'button',
        {
          class: 'btn primary',
          type: 'button',
          onclick: async () => {
            // дата скачивания запоминается до сериализации — она попадёт и в сам бэкап
            await update((x) => ({ ...x, lastBackupAt: today() }));
            download(`capital-os-${today()}.json`, serializeState(getState(), today()));
          },
        },
        'Скачать бэкап (JSON)',
      ),
      h('label', { class: 'btn file-btn' }, 'Восстановить из файла', input),
      confirmButton('Стереть все данные', 'Точно стереть всё?', () => replaceState(emptyState()).then(() => toast('Данные стёрты'))),
    ),
    errBox,
  );
}

/** Разделы «Моих денег» и «Расчётов» — по ним выбирается вкладка при переходе #/settings/<раздел>. */
const CALC = ['classification', 'params', 'strategy', 'scenarios'] as const;

export function renderSettings(section?: string): HTMLElement {
  const st = getState();
  const o = buildOverview(st, today());
  const calc = section === 'calc' || (CALC as readonly string[]).includes(section ?? '');
  const tab = (id: string, label: string, active: boolean) => h('a', { class: `seg${active ? ' active' : ''}`, href: `#/settings/${id}` }, label);
  // неприменимые к данным разделы скрыты (функция вернула null), редкие свёрнуты (D70).
  // Долги на начало: наверху, если данные о них просят; иначе — в «Редко нужно» (долг до начала данных мог и не возвращаться).
  const debts = openingDebtsSection(st, o);
  const d0 = st.settings.openingDebts;
  const debtsNeeded = o.capital.explanation.some((x) => x.code === 'capital.payables_negative' || x.code === 'capital.receivables_negative') || d0.receivable > 0 || d0.payable > 0;
  const money: [string, HTMLElement | null][] = [
    ['accounts', accountsSection(st)],
    ['income', incomeSection(st)],
    ['obligations', obligationsSection(st, o)],
    ['savings', savingsFlowsSection(st)],
    ...(debtsNeeded ? ([['debts', debts]] as [string, HTMLElement][]) : []),
    ['backup', backupSection()],
    ['install', installBlock()],
  ];
  const rare: [string, HTMLElement][] = [
    ...(debtsNeeded ? [] : ([['debts', debts]] as [string, HTMLElement][])),
    ['manual', manualAccountsSection(st)],
    ['adjustments', adjustmentsSection(st)],
  ];
  const calcs: [string, HTMLElement][] = [
    ['classification', classificationSection(st)],
    ['params', paramsSection(st)],
    ['strategy', strategySection(st)],
    ['scenarios', scenariosSection(st)],
  ];
  const visible = money.filter((x): x is [string, HTMLElement] => x[1] !== null);
  return h(
    'div',
    { class: 'screen' },
    h('div', { class: 'segmented' }, tab('money', 'Мои деньги', !calc), tab('calc', 'Расчёты', calc)),
    h('p', { class: 'muted' }, calc ? 'Как система считает: правила разметки, параметры, коэффициенты, сценарии. Значения по умолчанию подходят большинству — меняй, только если знаешь зачем.' : 'Счета, доходы, рассрочки — то, что есть только у тебя. Сюда заходишь, когда что-то меняется в жизни. У каждого раздела написано, нужен ли он тебе.'),
    ...(calc
      ? calcs.map(([id, el]) => anchor(el, id))
      : [
          ...visible.map(([id, el]) => anchor(el, id)),
          h('details', { class: 'rare', 'data-key': 'settings:rare' }, h('summary', null, `Редко нужно: ${debtsNeeded ? '' : 'долги на начало учёта, '}ручные счета и корректировки`), ...rare.map(([id, el]) => anchor(el, id))),
        ]),
  );
}
