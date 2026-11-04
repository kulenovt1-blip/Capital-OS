/**
 * «Планирую…» (D101): что если — одно событие за раз, только нужные поля, ответ словами.
 *  - каждый вид события — своя короткая форма: у «Закрыть долг досрочно» — только какой долг и когда
 *    (сумма и название берутся из заведённого долга), у «Конец учёбы» — только какой доход и с какой даты;
 *  - результат — фразами: «Через год: 1,1 млн вместо 1,3 млн — на 180 000 ₸ меньше», «Подушка — позже на 2 мес.»;
 *  - «Добавить в план» — событие входит в прогноз; следующие события сравниваются уже с планом, так они складываются.
 */
import {
  addDays, addMonths, formatDateRu, runWhatIf,
  type LifeEvent, type Money, type MonthKey, type WhatIfResult,
} from '../../engine/index';
import { field, h } from '../dom';
import { act, getState, today } from '../store';
import { ov } from '../ctx';
import { errorsBox, fmt, fmtShort, monthGen, monthTo, monthWord, moneyInput, newId, nWord, readMoney, readStr, row, rows, seg, stickyBar, sub } from '../ui';
import { closeSheet, defineSheet, refresh, sheetHref } from '../main';

type Kind = 'job' | 'study' | 'loss' | 'change' | 'cut' | 'move' | 'buy' | 'inst' | 'payoff';

interface KindDef {
  label: string;
  /** Одна строка: что это значит. */
  hint: string;
}

export const KINDS: Record<Kind, KindDef> = {
  job: { label: 'Новая работа', hint: 'появится новый доход в месяц' },
  study: { label: 'Конец учёбы', hint: 'стипендия или другой доход закончится' },
  loss: { label: 'Потеря дохода', hint: 'один из доходов пропадёт' },
  change: { label: 'Доход изменится', hint: 'прибавка или снижение — новая сумма в месяц' },
  cut: { label: 'Урежу траты', hint: 'буду тратить меньше в месяц' },
  move: { label: 'Переезд, аренда', hint: 'траты в месяц станут больше или меньше' },
  buy: { label: 'Крупная покупка', hint: 'разовая трата' },
  inst: { label: 'Новая рассрочка', hint: 'платёж в месяц на несколько месяцев' },
  payoff: { label: 'Закрыть долг досрочно', hint: 'погасить остаток рассрочки или долга сразу' },
};

/** Порядок кнопок «Планирую…» на «Прогнозе». */
export const PLAN_CHIPS: Kind[] = ['job', 'study', 'cut', 'move', 'buy', 'inst', 'loss', 'payoff', 'change'];

let draft: { kind: Kind; event: LifeEvent; result: WhatIfResult } | null = null;
let draftKind: Kind | null = null;
/** Что введено в форму — чтобы после «Посчитать» поля не очищались. */
let typed: Record<string, string> = {};
let typedDirection: 'more' | 'less' = 'more';

const dmy = (d: string) => formatDateRu(d);
const nextMonthStart = () => {
  const t = today();
  return `${addMonths(t, 1).slice(0, 7)}-01`;
};

// ───────────────────────── формы ─────────────────────────

/** Выбор из списка + строка под ним с подробностями выбранного (в самом списке — только название, чтобы не обрезалось). */
function pickField(label: string, name: string, items: { id: string; title: string; detail: string }[], selected: string): HTMLElement {
  const sel = h('select', { name }, items.map((x) => h('option', { value: x.id, selected: x.id === selected }, x.title)));
  const hint = h('small', { class: 'hint' });
  const sync = () => (hint.textContent = items.find((x) => x.id === sel.value)?.detail ?? '');
  sel.addEventListener('change', sync);
  sync();
  return h('label', { class: 'field' }, h('span', { class: 'field-label' }, label), sel, hint);
}

function incomeSelect(kind: Kind): HTMLElement | null {
  const items = getState().settings.incomeSchedule;
  if (!items.length) return null;
  const re = kind === 'study' ? /стипенд|учёб|учеб/i : null;
  const pre = (re ? items.find((x) => re.test(x.title)) : undefined) ?? [...items].sort((a, b) => b.amount - a.amount)[0]!;
  return pickField('Какой доход', 'income', items.map((x) => ({ id: x.id, title: x.title, detail: `${fmt(x.amount)} в месяц, ${x.dayOfMonth}-го${x.end ? ` · уже заканчивается ${dmy(x.end)}` : ''}` })), pre.id);
}

function debtSelect(): HTMLElement | null {
  const o = ov();
  const live = o.obligations.filter((s) => s.obligation.kind !== 'recurring' && s.effectiveUpcoming.length > 0);
  if (!live.length) return null;
  return pickField(
    'Какой долг',
    'debt',
    live.map((s) => {
      const up = s.effectiveUpcoming;
      const left = up.reduce((a, e) => a + e.amount, 0) as Money;
      return { id: s.obligation.id, title: s.obligation.title, detail: `осталось ${fmt(left)} · ${nWord(up.length, 'платёж', 'платежа', 'платежей')} по ${fmt(up[0]!.amount)}, последний ${dmy(up[up.length - 1]!.date)}` };
    }),
    live[0]!.obligation.id,
  );
}

function dateField(name: string, label: string, value: string, hint?: string): HTMLElement {
  return field(label, h('input', { name, type: 'date', value, required: true }), hint);
}

/** Поля для вида события. Возвращает null, если событие не из чего построить (нет доходов, нет долгов). */
function kindForm(kind: Kind): { form: HTMLFormElement; read: () => { event?: LifeEvent; errs: string[] } } | { empty: HTMLElement } {
  const st = getState();
  const id = 'plan-form';
  let direction: 'more' | 'less' = typedDirection;
  const dirBox = h('div');
  const drawDir = () => dirBox.replaceChildren(seg([['more', 'Тратить больше'], ['less', 'Тратить меньше']] as const, direction, (v) => ((direction = typedDirection = v), drawDir()), 'Траты'));
  drawDir();
  const parts: (HTMLElement | null)[] = [];
  if (kind === 'study' || kind === 'loss' || kind === 'change') {
    const sel = incomeSelect(kind);
    if (!sel) return { empty: h('div', { class: 'card stack' }, h('strong', null, 'Доходов не заведено'), h('p', { class: 'muted' }, 'Сначала добавь, какие доходы у тебя есть.'), h('a', { class: 'btn primary wide', href: '#/incomes' }, 'Открыть «Доходы»')) };
    parts.push(sel);
  }
  if (kind === 'payoff') {
    const sel = debtSelect();
    if (!sel) return { empty: h('div', { class: 'card stack' }, h('strong', null, 'Нет рассрочек и долгов с будущими платежами'), h('p', { class: 'muted' }, 'Если долг есть — заведи его, и приложение посчитает, что даст досрочное погашение.'), h('a', { class: 'btn primary wide', href: '#/debts' }, 'Открыть «Долги и рассрочки»')) };
    parts.push(sel);
  }
  const titleLabel: Partial<Record<Kind, [string, string]>> = { job: ['Откуда доход', 'Новая работа'], cut: ['На чём', 'Меньше трат'], move: ['Что меняется', 'Аренда'], buy: ['Что покупаешь', ''], inst: ['Что берёшь в рассрочку', ''] };
  const tl = titleLabel[kind];
  if (tl) parts.push(field(tl[0], h('input', { name: 'title', value: tl[1], placeholder: kind === 'buy' || kind === 'inst' ? 'Например: ноутбук' : '', autocomplete: 'off', required: true })));
  const amountLabel: Partial<Record<Kind, string>> = { job: 'Сколько в месяц, ₸', cut: 'На сколько меньше в месяц, ₸', move: 'На сколько в месяц, ₸', buy: 'Сколько стоит, ₸', inst: 'Платёж в месяц, ₸', change: 'Новая сумма в месяц, ₸' };
  if (kind === 'move') parts.push(dirBox);
  if (amountLabel[kind]) parts.push(field(amountLabel[kind]!, moneyInput('amount')));
  if (kind === 'inst') parts.push(field('Сколько месяцев', h('input', { name: 'months', type: 'number', min: 1, max: 60, inputmode: 'numeric', value: '12' })));
  const dateLabel: Record<Kind, string> = {
    job: 'Первая зарплата', study: 'С какого числа дохода не будет', loss: 'С какого числа дохода не будет', change: 'С какого числа новая сумма',
    cut: 'С какого числа',
    move: 'С какого числа', buy: 'Когда', inst: 'Первый платёж', payoff: 'Когда закроешь',
  };
  parts.push(dateField('date', dateLabel[kind], kind === 'buy' || kind === 'payoff' ? today() : nextMonthStart(), kind === 'job' ? 'дальше — каждый месяц в этот же день' : undefined));
  if (kind === 'job' || kind === 'move' || kind === 'cut') parts.push(field('До какого числа (если временно)', h('input', { name: 'until', type: 'date' }), 'пусто — без конца'));
  const err = h('div');
  const form = h('form', { class: 'stack', id }, ...parts.filter(Boolean), err);
  for (const [k, v] of Object.entries(typed)) {
    const el = form.querySelector(`[name="${k}"]`) as HTMLInputElement | HTMLSelectElement | null;
    if (el) {
      el.value = v;
      el.dispatchEvent(new Event('change'));
    }
  }

  const read = () => {
    const errs: string[] = [];
    const date = readStr(form, 'date');
    if (!date) errs.push('Укажи дату');
    else if (date < today()) errs.push('Дата уже прошла — укажи сегодня или позже');
    const until = readStr(form, 'until');
    if (until && date && until <= date) errs.push('«До» должно быть позже начала');
    const amount = amountLabel[kind] ? readMoney(form, 'amount') : null;
    if (amountLabel[kind] && (amount === null || amount <= 0)) errs.push('Введи сумму больше нуля');
    const title = readStr(form, 'title');
    if (tl && !title) errs.push('Напиши, что это');
    const income = st.settings.incomeSchedule.find((x) => x.id === readStr(form, 'income'));
    const debt = ov().obligations.find((s) => s.obligation.id === readStr(form, 'debt'));
    const months = Math.floor(Number(readStr(form, 'months')));
    if (kind === 'inst' && !(months >= 1 && months <= 60)) errs.push('Сколько месяцев — от 1 до 60');
    if (kind === 'study' || kind === 'loss') {
      if (income?.end && date && income.end < date) errs.push(`«${income.title}» и так заканчивается ${dmy(income.end)} — это уже учтено в прогнозе`);
    }
    err.replaceChildren(errorsBox(errs) ?? '');
    if (errs.length) return { errs };
    const base = { id: newId('ev'), date } as const;
    let event: LifeEvent;
    switch (kind) {
      case 'job':
        event = { ...base, kind: 'income_start', title, amount: amount!, dayOfMonth: Number(date.slice(8, 10)), incomeKind: 'work', ...(until ? { until } : {}) };
        break;
      case 'study':
      case 'loss':
        event = { ...base, kind: 'income_stop', title: `${income!.title}: дохода не будет`, target: income!.id, amount: 0 as Money };
        break;
      case 'change':
        event = { ...base, kind: 'income_change', title: `${income!.title}: ${fmt(amount!)} в месяц`, target: income!.id, amount: amount! };
        break;
      case 'cut':
        event = { ...base, kind: 'recurring_change', title, amount: -amount! as Money, ...(until ? { until } : {}) };
        break;
      case 'move':
        event = { ...base, kind: 'recurring_change', title, amount: (direction === 'less' ? -amount! : amount!) as Money, ...(until ? { until } : {}) };
        break;
      case 'buy':
        event = { ...base, kind: 'one_off', title, amount: amount! };
        break;
      case 'inst':
        event = { ...base, kind: 'recurring_change', title: `Рассрочка: ${title} (${nWord(months, 'месяц', 'месяца', 'месяцев')})`, amount: amount!, until: addDays(addMonths(date, months), -1) };
        break;
      case 'payoff':
        event = { ...base, kind: 'obligation_payoff', title: `Закрыть «${debt!.obligation.title}» досрочно`, target: debt!.obligation.id, amount: 0 as Money };
        break;
    }
    return { event, errs };
  };
  return { form, read };
}

// ───────────────────────── результат словами ─────────────────────────

function capitalLine(res: WhatIfResult, k: number, word: string): HTMLElement | null {
  const b = res.base.months[k];
  const w = res.with.months[k];
  if (!b || !w) return null;
  const d = w.capital - b.capital;
  const text = d === 0 ? 'столько же' : `${fmtShort(w.capital)} вместо ${fmtShort(b.capital)}`;
  return row({ title: word, sub: text, value: d === 0 ? 'без изменений' : h('span', { class: d < 0 ? 'neg' : 'good' }, `${d > 0 ? '+' : '−'}${fmt(Math.abs(d) as Money)}`) });
}

function goalLines(res: WhatIfResult): HTMLElement[] {
  const goals = ov().goals.filter((g) => g.status === 'active' && !g.folder);
  const horizon = Math.round(res.base.months.length / 12);
  const out: HTMLElement[] = [];
  for (const g of goals) {
    const a = res.base.goalDates[g.id] as MonthKey | null | undefined;
    const b = res.with.goalDates[g.id] as MonthKey | null | undefined;
    if (a === b || (a === undefined && b === undefined)) continue;
    const name = g.role === 'safety' && g.parentId === undefined ? 'Подушка' : g.title;
    let text: string;
    if (!b) text = `не накопится за ${nWord(horizon, 'год', 'года', 'лет')}${a ? ` (без этого — ${monthWord(a)})` : ''}`;
    else if (!a) text = `накопится к ${monthTo(b)} (раньше не успевала)`;
    else {
      const m = (Number(b.slice(0, 4)) - Number(a.slice(0, 4))) * 12 + Number(b.slice(5, 7)) - Number(a.slice(5, 7));
      text = `${m > 0 ? 'позже' : 'раньше'} на ${nWord(Math.abs(m), 'месяц', 'месяца', 'месяцев')}: ${monthWord(b)} вместо ${monthGen(a)}`;
    }
    out.push(row({ title: name, sub: text }));
  }
  return out;
}

function resultCard(res: WhatIfResult, event: LifeEvent): HTMLElement {
  const goals = goalLines(res);
  const gap = res.newGaps[0];
  const payoff = event.kind === 'obligation_payoff';
  const liquid = (k: number) => (res.with.months[k]?.liquidEnd ?? 0) - (res.base.months[k]?.liquidEnd ?? 0);
  return h(
    'div',
    { class: 'advice' },
    h('div', { class: 'big' }, 'Что изменится'),
    sub('Всего у тебя будет'),
    rows(capitalLine(res, 6, 'Через полгода'), capitalLine(res, 12, 'Через год')),
    payoff
      ? h('p', { class: 'gs' }, `Всего у тебя почти не меняется: деньги уходят на долг, но и долг исчезает. На счетах сразу после — ${liquid(0) < 0 ? `на ${fmt(-liquid(0) as Money)} меньше` : 'столько же'}, а дальше платежи по этому долгу больше не нужны.`)
      : null,
    sub('Цели'),
    goals.length ? rows(goals) : h('p', { class: 'gs' }, 'Сроки целей не меняются.'),
    gap
      ? h('div', { class: 'badline' }, h('strong', null, `Денег не хватит с ${formatDateRu(gap.start)}`), h('div', null, `в худший день — минус ${fmt(gap.maxDeficit)}. Нужен запас или другой срок.`))
      : h('div', { class: 'okline' }, 'Денег хватает каждый месяц ✓'),
  );
}

// ───────────────────────── подэкран ─────────────────────────

defineSheet('plan', (raw) => {
  // «вид@ГГГГ-ММ-ДД» — форма с подставленной датой (вопрос «Что изменится?» на «Прогнозе», D108)
  const [arg = '', preset] = raw.split('@');
  const kind = (arg in KINDS ? arg : null) as Kind | null;
  if (!kind) {
    // «Своё событие»: сначала — что происходит, списком с пояснениями
    return {
      title: 'Что планируешь?',
      body: rows((Object.keys(KINDS) as Kind[]).map((k) => row({ title: KINDS[k].label, sub: KINDS[k].hint, href: sheetHref('plan', k) }))),
    };
  }
  if (draftKind !== kind || (preset && typed.date !== preset)) {
    draft = null;
    draftKind = kind;
    typed = preset ? { date: preset } : {};
    typedDirection = 'more';
  }
  const f = kindForm(kind);
  if ('empty' in f) return { title: KINDS[kind].label, body: f.empty };
  f.form.addEventListener('submit', (e) => {
    e.preventDefault();
    const { event } = f.read();
    typed = Object.fromEntries([...f.form.querySelectorAll('input[name], select[name]')].map((el) => [(el as HTMLInputElement).name, (el as HTMLInputElement).value]));
    if (!event) return;
    const all = runWhatIf(getState(), today(), [event]);
    const result = all.find((r) => r.scenarioId === 'base') ?? all[0];
    if (!result) return;
    draft = { kind, event, result };
    refresh();
    setTimeout(() => document.querySelector('.sheet .advice')?.scrollIntoView({ block: 'start', behavior: 'smooth' }), 50);
  });
  const add = async () => {
    if (!draft) return;
    const ev = draft.event;
    draft = null;
    typed = {};
    await act((s) => ({ ...s, settings: { ...s.settings, plannedEvents: [...s.settings.plannedEvents, ev] } }), `«${ev.title}» — в плане, прогноз пересчитан`);
    closeSheet();
  };
  return {
    title: KINDS[kind].label,
    body: h(
      'div',
      { class: 'stack' },
      h('p', { class: 'muted' }, `${KINDS[kind].hint[0]!.toUpperCase()}${KINDS[kind].hint.slice(1)}. Заполни и нажми «Посчитать» — в план ничего не попадёт, пока не нажмёшь «Добавить в план».`),
      f.form,
      h('button', { class: `btn wide${draft ? '' : ' primary'}`, type: 'submit', form: 'plan-form' }, draft ? 'Пересчитать' : 'Посчитать'),
      draft ? resultCard(draft.result, draft.event) : null,
    ),
    bar: draft ? stickyBar(null, h('button', { class: 'btn primary', type: 'button', onclick: () => void add() }, 'Добавить в план')) : undefined,
  };
});

/** Событие из плана — строкой, словами. */
export function eventLine(e: LifeEvent): string {
  const when = formatDateRu(e.date);
  switch (e.kind) {
    case 'income_start':
      return `с ${when} · +${fmt(e.amount)} в месяц${e.until ? ` до ${formatDateRu(e.until)}` : ''}`;
    case 'income_stop':
      return `с ${when}`;
    case 'income_change':
      return `с ${when}`;
    case 'recurring_change':
      return `с ${when} · ${e.amount < 0 ? '−' : '+'}${fmt(Math.abs(e.amount) as Money)} трат в месяц${e.until ? ` до ${formatDateRu(e.until)}` : ''}`;
    case 'one_off':
      return `${when} · ${fmt(e.amount)}`;
    case 'obligation_payoff':
      return when;
  }
}
