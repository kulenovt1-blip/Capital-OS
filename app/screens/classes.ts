/** «Разметка» (D84, бывшие «Классы»): категории → типы; свои типы — во второй вкладке. Слово «класс» на экране не используется. */
import {
  BEHAVIOR_HINTS, BEHAVIOR_LABELS, CLASS_LABELS, canDeleteClass, classFromAnswers, classRegistry, classifyAll, createCustomClass, setCategoryClass, suggestClassForCategory, behaviorFits,
  type Behavior, type ClassDef, type ClassOverride, type OpClass, type WizardAnswers,
} from '../../engine/index';
import { confirmButton, field, h, toast } from '../dom';
import { getState, update } from '../store';
import { errorsBox, fmt, fmtDate, info, moneyInput, readMoney, readStr, seg, typeLabel } from '../ui';
import { closeSheet, defineSheet, go, sheetHref } from '../main';
import { markupList } from '../blocks';

function radio(name: string, options: [string, string][], onChange: () => void): HTMLElement {
  return h(
    'div',
    { class: 'radios' },
    options.map(([v, label]) => h('label', { class: 'check' }, h('input', { type: 'radio', name, value: v, onchange: onChange }), ` ${label}`)),
  );
}

function wizard(): HTMLElement {
  const form = h('form', { class: 'stack wizard' });
  const preview = h('div', { class: 'preview' });
  const err = h('div');
  const val = (n: string) => (form.querySelector(`input[name="${n}"]:checked`) as HTMLInputElement | null)?.value ?? '';
  const q = (key: string, text: string, control: HTMLElement, help?: HTMLElement) => h('div', { class: 'q', 'data-q': key, hidden: true }, h('div', { class: 'q-text' }, text, help ?? ''), control);

  const refresh = () => {
    const show = (k: string, on: boolean) => {
      const el = form.querySelector(`[data-q="${k}"]`) as HTMLElement;
      el.hidden = !on;
    };
    const group = val('group');
    const exp = group === 'expense';
    const inc = group === 'income';
    show('returns', exp);
    show('transfer', exp && val('returns') === 'no');
    show('installment', exp && val('transfer') === 'no');
    const past3 = exp && val('installment') === 'no';
    show('essential', past3);
    show('frequency', past3 && val('essential') === 'no');
    const freq = val('frequency');
    show('ends', past3 && (val('essential') === 'yes' || freq === 'monthly'));
    show('estimate', past3 && val('essential') === 'no' && freq === 'irregular');
    show('canStop', inc);
    show('incomeEnds', inc && val('canStop') !== '');
    (form.querySelector('[name="endDate"]') as HTMLInputElement).hidden = val('ends') !== 'yes';
    (form.querySelector('[name="incomeEndDate"]') as HTMLInputElement).hidden = val('incomeEnds') !== 'yes';

    const a = answers();
    preview.replaceChildren();
    if (!a) return;
    const r = classFromAnswers(a);
    if (r.kind === 'redirect') {
      preview.append(h('div', { class: 'notice warn' }, r.text));
      (form.querySelector('button[type=submit]') as HTMLButtonElement).disabled = true;
      return;
    }
    (form.querySelector('button[type=submit]') as HTMLButtonElement).disabled = false;
    preview.append(h('div', { class: 'notice info' }, h('strong', null, `Как считать в прогнозе: ${BEHAVIOR_LABELS[r.behavior]}`), h('ul', null, r.effects.map((e) => h('li', null, e)))));
  };

  /** Ответы, если вопросы до конца ветки заполнены; иначе null. */
  const answers = (): WizardAnswers | null => {
    const group = val('group');
    if (group === 'income') {
      if (!val('canStop') || !val('incomeEnds')) return null;
      const d = readStr(form, 'incomeEndDate');
      if (val('incomeEnds') === 'yes' && !d) return null;
      return { group: 'income', canStop: val('canStop') === 'yes', incomeEnds: val('incomeEnds') === 'yes' ? d : null };
    }
    if (group !== 'expense' || !val('returns')) return null;
    const a: WizardAnswers = { group: 'expense', returnsOrRepaid: val('returns') === 'yes' };
    if (a.returnsOrRepaid) return a;
    if (!val('transfer')) return null;
    a.ownTransfer = val('transfer') === 'yes';
    if (a.ownTransfer) return a;
    if (!val('installment')) return null;
    a.installment = val('installment') === 'yes';
    if (a.installment) return a;
    if (!val('essential')) return null;
    a.essential = val('essential') === 'yes';
    if (!a.essential) {
      const f = val('frequency');
      if (!f) return null;
      a.frequency = f as WizardAnswers['frequency'];
    } else a.frequency = 'monthly';
    if (a.frequency === 'monthly') {
      if (!val('ends')) return null;
      const d = readStr(form, 'endDate');
      if (val('ends') === 'yes' && !d) return null;
      a.ends = val('ends') === 'yes' ? d : null;
    }
    if (a.frequency === 'irregular') {
      const est = readStr(form, 'estimate') ? readMoney(form, 'estimate') : null;
      a.annualEstimate = est;
    }
    return a;
  };

  form.append(
    field('Название типа', h('input', { name: 'label', required: true, placeholder: 'Подарки, Курсы, Такси…' })),
    h('div', { class: 'q' }, h('div', { class: 'q-text' }, 'Это доход или трата?'), radio('group', [['expense', 'трата'], ['income', 'доход']], refresh)),
    q('returns', 'Эти деньги вернутся к тебе или ты их вернёшь кому-то?', radio('returns', [['no', 'нет'], ['yes', 'да — это долг']], refresh)),
    q('transfer', 'Ты просто перекладываешь деньги между своими счетами?', radio('transfer', [['no', 'нет'], ['yes', 'да']], refresh)),
    q('installment', 'Это платёж по рассрочке или кредиту?', radio('installment', [['no', 'нет'], ['yes', 'да']], refresh)),
    q('essential', 'Без этого не прожить месяц?', radio('essential', [['yes', 'да — продукты, транспорт, связь'], ['no', 'нет']], refresh), info('baseline')),
    q('frequency', 'Как часто ты на это тратишь?', radio('frequency', [['monthly', 'каждый месяц'], ['irregular', 'несколько раз в год, неравномерно'], ['once', 'один раз, больше не повторится']], refresh)),
    q('ends', 'Это когда-нибудь закончится?', h('div', null, radio('ends', [['no', 'нет'], ['yes', 'да, к дате:']], refresh), h('input', { name: 'endDate', type: 'date', hidden: true, onchange: refresh }))),
    q('estimate', 'Сколько примерно уходит на это за год? (можно оставить пустым)', moneyInput('estimate', undefined, 'например, 120 000'), info('irregularEstimate')),
    q('canStop', 'Этот доход может пропасть или задержаться (как зарплата)?', radio('canStop', [['yes', 'да — это работа'], ['no', 'нет']], refresh)),
    q('incomeEnds', 'Он когда-нибудь закончится?', h('div', null, radio('incomeEnds', [['no', 'нет'], ['yes', 'да, к дате:']], refresh), h('input', { name: 'incomeEndDate', type: 'date', hidden: true, onchange: refresh }))),
    preview,
    h('button', { class: 'btn primary wide', type: 'submit', disabled: true }, 'Создать тип'),
    err,
  );
  form.querySelector('[name="estimate"]')!.addEventListener('input', refresh);
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const a = answers();
    const label = readStr(form, 'label');
    if (!label) return err.replaceChildren(errorsBox(['Нужно название типа']) ?? '');
    if (!a) return err.replaceChildren(errorsBox(['Ответь на все вопросы']) ?? '');
    const r = classFromAnswers(a);
    if (r.kind !== 'class') return;
    const c = createCustomClass({ label, group: r.group, behavior: r.behavior, ...(r.endDate ? { endDate: r.endDate } : {}), ...(r.annualEstimate !== undefined ? { annualEstimate: r.annualEstimate } : {}) }, getState().settings.classes);
    if (!c.ok) return err.replaceChildren(errorsBox([c.error]) ?? '');
    await update((s) => ({ ...s, settings: { ...s.settings, classes: { ...s.settings.classes, custom: [...s.settings.classes.custom, c.value] } } }));
    toast(`Тип «${c.value.label}» создан — его можно выбрать для категорий`);
    closeSheet();
  });
  return form;
}

/** Изменить поведение класса (свой — целиком, встроенный — только поведение и параметры). */
function editClass(c: ClassDef): HTMLElement {
  const options = (Object.keys(BEHAVIOR_LABELS) as Behavior[]).filter((b) => behaviorFits(c.group, b));
  const form = h(
    'form',
    { class: 'grid-form' },
    field('Как считать в прогнозе', h('select', { name: 'behavior' }, options.map((b) => h('option', { value: b, selected: b === c.behavior }, BEHAVIOR_LABELS[b])))),
    field('Дата окончания (необязательно; для временного — обязательно)', h('input', { name: 'endDate', type: 'date', value: c.endDate ?? '' })),
    c.group === 'expense' ? field('Оценка на год, ₸ (для нерегулярного)', moneyInput('estimate', c.annualEstimate, '')) : null,
    h('button', { class: 'btn primary', type: 'submit' }, 'Сохранить'),
  );
  const err = h('div');
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const behavior = readStr(form, 'behavior') as Behavior;
    const endDate = readStr(form, 'endDate') || undefined;
    const estStr = c.group === 'expense' ? readStr(form, 'estimate') : '';
    const annualEstimate = estStr ? (readMoney(form, 'estimate') ?? undefined) : undefined;
    if (behavior === 'temporary' && !endDate) return err.replaceChildren(errorsBox(['Для временного типа нужна дата окончания']) ?? '');
    const patch: ClassOverride = { behavior, ...(endDate ? { endDate } : {}), ...(annualEstimate !== undefined ? { annualEstimate } : {}) };
    await update((s) => {
      const cs = s.settings.classes;
      const classes = c.builtin
        ? { ...cs, overrides: { ...cs.overrides, [c.id]: patch } }
        : { ...cs, custom: cs.custom.map((x) => (x.id === c.id ? { id: x.id, label: x.label, group: x.group, builtin: false, ...patch, behavior } : x)) };
      return { ...s, settings: { ...s.settings, classes } };
    });
    toast(`«${c.label}»: ${BEHAVIOR_LABELS[behavior]}`);
  });
  return h('div', null, form, err);
}

function typesList(): HTMLElement {
  const st = getState();
  const reg = classRegistry(st.settings.classes);
  const item = (c: ClassDef) => {
    const d = c.builtin ? null : canDeleteClass(c.id, st.settings.classification);
    return h(
      'div',
      { class: 'card stack' },
      h('div', { class: 'btn-row', style: 'justify-content:space-between' }, h('strong', null, typeLabel(c.id, reg)), c.builtin ? null : h('span', { class: 'tag' }, 'свой')),
      h('div', { class: 'muted' }, `${BEHAVIOR_LABELS[c.behavior]}${c.endDate ? ` · до ${fmtDate(c.endDate)}` : ''}${c.annualEstimate !== undefined ? ` · оценка ${fmt(c.annualEstimate)} в год` : ''}`),
      c.behavior === 'installment' ? h('small', { class: 'muted' }, BEHAVIOR_HINTS.installment) : h('details', { class: 'fold', 'data-key': `class:${c.id}` }, h('summary', null, 'Изменить'), editClass(c)),
      d ? (d.ok ? confirmButton('Удалить тип', 'Удалить тип?', () => update((s) => ({ ...s, settings: { ...s.settings, classes: { ...s.settings.classes, custom: s.settings.classes.custom.filter((x) => x.id !== c.id) } } }))) : h('small', { class: 'muted' }, d.reason ?? '')) : null,
    );
  };
  const own = reg.filter((c) => !c.builtin);
  return h(
    'div',
    { class: 'stack' },
    h('a', { class: 'btn primary wide', href: sheetHref('new-type') }, '＋ Свой тип'),
    h('h3', { class: 'sub' }, `Свои (${own.length})`),
    own.length ? own.map(item) : h('p', { class: 'one-line' }, 'Своих типов пока нет. Встроенных обычно хватает; свой нужен, если трату надо считать по-особому.'),
    h('details', { class: 'fold', 'data-key': 'classes:exp' }, h('summary', null, 'Встроенные: траты'), h('div', { class: 'stack' }, reg.filter((c) => c.builtin && c.group === 'expense').map(item))),
    h('details', { class: 'fold', 'data-key': 'classes:inc' }, h('summary', null, 'Встроенные: доходы'), h('div', { class: 'stack' }, reg.filter((c) => c.builtin && c.group === 'income').map(item))),
  );
}

defineSheet('new-type', () => ({ title: 'Новый тип', body: h('div', { class: 'stack' }, h('p', { class: 'muted' }, 'Ответь на вопросы — из ответов выйдет, как считать этот тип в прогнозе.'), wizard()) }));

export function renderClasses(rerender: () => void, section?: string): HTMLElement {
  const own = section === 'own';
  return h(
    'div',
    { class: 'screen' },
    seg<'cat' | 'own'>([['cat', 'Категории'], ['own', 'Свои типы']], own ? 'own' : 'cat', (v) => go(v === 'own' ? '#/markup/own' : '#/markup'), 'Вкладки'),
    own ? typesList() : markupList(rerender),
  );
}
