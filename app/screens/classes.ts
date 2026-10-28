/** Экран «Классы»: мастер создания класса, поведение классов, переразметка любой категории. */
import {
  BEHAVIOR_HINTS, BEHAVIOR_LABELS, CLASS_LABELS, canDeleteClass, classFromAnswers, classRegistry, classifyAll, createCustomClass, setCategoryClass, suggestClassForCategory, behaviorFits,
  type Behavior, type ClassDef, type ClassOverride, type OpClass, type WizardAnswers,
} from '../../engine/index';
import { confirmButton, field, h, section, table, toast } from '../dom';
import { getState, update } from '../store';
import { anchor, classSelect, errorsBox, fmt, fmtDate, info, moneyInput, readMoney, readStr } from '../ui';

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
    preview.append(h('div', { class: 'notice info' }, h('strong', null, `Поведение: ${BEHAVIOR_LABELS[r.behavior]}`), h('ul', null, r.effects.map((e) => h('li', null, e)))));
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
    field('Название класса', h('input', { name: 'label', required: true, placeholder: 'Подарки, Курсы, Такси…' })),
    h('div', { class: 'q' }, h('div', { class: 'q-text' }, 'Это доход или расход?'), radio('group', [['expense', 'расход'], ['income', 'доход']], refresh)),
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
    h('button', { class: 'btn primary', type: 'submit', disabled: true }, 'Создать класс'),
    err,
  );
  form.querySelector('[name="estimate"]')!.addEventListener('input', refresh);
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const a = answers();
    const label = readStr(form, 'label');
    if (!label) return err.replaceChildren(errorsBox(['Нужно название класса']) ?? '');
    if (!a) return err.replaceChildren(errorsBox(['Ответь на все вопросы']) ?? '');
    const r = classFromAnswers(a);
    if (r.kind !== 'class') return;
    const c = createCustomClass({ label, group: r.group, behavior: r.behavior, ...(r.endDate ? { endDate: r.endDate } : {}), ...(r.annualEstimate !== undefined ? { annualEstimate: r.annualEstimate } : {}) }, getState().settings.classes);
    if (!c.ok) return err.replaceChildren(errorsBox([c.error]) ?? '');
    await update((s) => ({ ...s, settings: { ...s.settings, classes: { ...s.settings.classes, custom: [...s.settings.classes.custom, c.value] } } }));
    toast(`Класс «${c.value.label}» создан — теперь его можно выбрать для категорий ниже`);
  });
  return form;
}

/** Изменить поведение класса (свой — целиком, встроенный — только поведение и параметры). */
function editClass(c: ClassDef): HTMLElement {
  const options = (Object.keys(BEHAVIOR_LABELS) as Behavior[]).filter((b) => behaviorFits(c.group, b));
  const form = h(
    'form',
    { class: 'grid-form' },
    field('Поведение', h('select', { name: 'behavior' }, options.map((b) => h('option', { value: b, selected: b === c.behavior }, `${BEHAVIOR_LABELS[b]} — ${BEHAVIOR_HINTS[b]}`)))),
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
    if (behavior === 'temporary' && !endDate) return err.replaceChildren(errorsBox(['Для временного класса нужна дата окончания']) ?? '');
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

function classesList(): HTMLElement {
  const st = getState();
  const reg = classRegistry(st.settings.classes);
  const row = (c: ClassDef) =>
    h(
      'li',
      { class: 'class-row' },
      h('div', null, h('strong', null, c.label), c.builtin ? h('small', { class: 'muted' }, ` ${c.id}`) : h('span', { class: 'badge' }, 'свой')),
      h(
        'div',
        { class: 'muted' },
        BEHAVIOR_LABELS[c.behavior],
        c.endDate ? ` · до ${fmtDate(c.endDate)}` : '',
        c.annualEstimate !== undefined ? ` · оценка ${fmt(c.annualEstimate)} в год` : '',
      ),
      c.behavior === 'installment' ? h('small', { class: 'muted' }, BEHAVIOR_HINTS.installment) : h('details', { class: 'add', 'data-key': `class:${c.id}` }, h('summary', null, 'Изменить'), editClass(c)),
      !c.builtin
        ? (() => {
            const d = canDeleteClass(c.id, st.settings.classification);
            return d.ok
              ? confirmButton('Удалить', 'Точно удалить?', () => update((s) => ({ ...s, settings: { ...s.settings, classes: { ...s.settings.classes, custom: s.settings.classes.custom.filter((x) => x.id !== c.id) } } })))
              : h('small', { class: 'muted' }, d.reason ?? '');
          })()
        : null,
    );
  return section(
    h('span', null, 'Классы и их поведение', info('behavior')),
    h('details', { class: 'add', open: st.settings.classes.custom.length > 0, 'data-key': 'classes:own' }, h('summary', null, `Свои (${st.settings.classes.custom.length})`), h('ul', { class: 'plain' }, reg.filter((c) => !c.builtin).map(row))),
    h('details', { class: 'add', 'data-key': 'classes:exp' }, h('summary', null, 'Встроенные расходы'), h('ul', { class: 'plain' }, reg.filter((c) => c.builtin && c.group === 'expense').map(row))),
    h('details', { class: 'add', 'data-key': 'classes:inc' }, h('summary', null, 'Встроенные доходы'), h('ul', { class: 'plain' }, reg.filter((c) => c.builtin && c.group === 'income').map(row))),
  );
}

function categoriesTable(): HTMLElement | null {
  const st = getState();
  if (!st.imported) return null;
  const data = st.imported;
  const reg = classRegistry(st.settings.classes);
  const cls = classifyAll(data, st.settings.classification);
  // текущий класс по (категория, вид операции): если уточнения дают разные классы — «смешано»
  const seen = new Map<string, { count: number; classes: Set<OpClass>; kind: 'income' | 'expense'; categoryId: string }>();
  for (const c of cls.ops) {
    if (c.op.kind === 'transfer' || c.op.categoryId === null) continue;
    const key = `${c.op.categoryId}|${c.op.kind}`;
    const v = seen.get(key) ?? { count: 0, classes: new Set<OpClass>(), kind: c.op.kind, categoryId: c.op.categoryId };
    v.count++;
    v.classes.add(c.cls);
    seen.set(key, v);
  }
  const rows = [...seen.values()]
    .map((v) => ({ ...v, cat: data.categories.find((c) => c.id === v.categoryId) }))
    .filter((v) => v.cat)
    // неразмеченные — сверху, дальше по алфавиту
    .sort((a, b) => Number(b.classes.has('UNCLASSIFIED')) - Number(a.classes.has('UNCLASSIFIED')) || a.cat!.label.localeCompare(b.cat!.label, 'ru'));
  return anchor(section(
    h('span', null, 'Категории → классы', info('classes')),
    h('p', { class: 'muted' }, 'Любую категорию можно переназначить: правило применится ко всем её операциям, в том числе в следующих импортах.'),
    table(
      ['Категория', 'Вид', 'Операций', 'Класс'],
      rows.map((r) => {
        const current = r.classes.size === 1 ? [...r.classes][0]! : '';
        return [
          r.cat!.label,
          r.kind === 'income' ? 'доход' : 'расход',
          String(r.count),
          h(
            'span',
            null,
            classSelect(r.kind, current === 'UNCLASSIFIED' ? '' : current, async (c) => {
              await update((s) => ({ ...s, settings: { ...s.settings, classification: setCategoryClass(s.settings.classification, r.cat!, c, r.kind) } }));
              toast(`«${r.cat!.label}» → ${reg.find((x) => x.id === c)?.label ?? c}`);
            }, reg),
            r.classes.size > 1 ? h('small', { class: 'warn-text' }, ' смешано (уточнения по тегам) — выбор заменит уточнения') : null,
            (() => {
              // подсказка по названию — только для неразмеченных (D72)
              if (current !== 'UNCLASSIFIED') return null;
              const hint = suggestClassForCategory(r.cat!.label, r.kind);
              if (!hint) return null;
              const label = reg.find((x) => x.id === hint)?.label ?? CLASS_LABELS[hint as keyof typeof CLASS_LABELS] ?? hint;
              return h(
                'button',
                {
                  class: 'btn small hint-btn',
                  type: 'button',
                  onclick: async () => {
                    await update((s) => ({ ...s, settings: { ...s.settings, classification: setCategoryClass(s.settings.classification, r.cat!, hint, r.kind) } }));
                    toast(`«${r.cat!.label}» → ${label}`);
                  },
                },
                `Похоже: ${label}`,
              );
            })(),
          ),
        ];
      }),
    ),
  ), 'categories');
}

export function renderClasses(): HTMLElement {
  return h(
    'div',
    { class: 'screen' },
    section(
      h('span', null, 'Новый класс', info('classes')),
      h('p', { class: 'muted' }, 'Ответь на вопросы — поведение класса выведется из ответов. Перед созданием видно, как класс будет считаться.'),
      wizard(),
    ),
    categoriesTable() ?? h('div', { class: 'notice info' }, 'Импортируй бэкап, чтобы размечать категории.'),
    classesList(),
  );
}

