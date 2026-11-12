/**
 * Экран «Цели» (D96, D100): подушка первая по умолчанию, но двигается, цели и папки по порядку, у цели со сроком — «успеваешь / не успеваешь».
 * Форма — три поля; деньги закрепляются за целью в отдельном подэкране с выбором счёта.
 */
import {
  STATUS_LABELS, assignMoney, withoutAuto, baseForecast, cushionFill, deleteGoal, buildGoalsView, changeStatus, createGoal, distributeSavings, exampleGoals, goalShifts, moveFunding, nextOrder, reorderGoals,
  starterGoals, unassignedSavings, updateGoal, withdrawMoney,
  type Goal, type GoalNode, type GoalStatus, type GoalsView, type Flexibility, type Money,
} from '../../engine/index';
import { append, ask, confirmButton, field, h, toast } from '../dom';
import { act, getState, today, update } from '../store';
import { chip, errorsBox, fmt, fmtDate, info, monthWord, toggle, moneyInput, newId, pct, readMoney, readStr, row, rows, seg, stickyBar, sub } from '../ui';
import { closeSheet, defineSheet, openSheet, refresh, sheetHref } from '../main';
import { explainLink, registerExplain } from '../explain';
import { forecastNow, ov, verdicts } from '../ctx';

const FLEX: Record<Flexibility, string> = { fixed: 'жёсткий', flexible: 'гибкий', open: 'без срока' };

function percent(n: GoalNode): string {
  const p = n.pctPermille / 10;
  return pct(p >= 10 ? Math.floor(p) : Math.floor(p * 10) / 10);
}

function deadlineText(g: Goal): string {
  if (g.deadline) return `к ${fmtDate(g.deadline)}`;
  if (g.desiredDate) return `желательно к ${fmtDate(g.desiredDate)}`;
  return 'без срока';
}

const view = (): GoalsView => buildGoalsView(getState(), today());
const nodeOf = (v: GoalsView, id: string) => v.flat.find((n) => n.goal.id === id);
const isCushion = (g: Goal) => g.role === 'safety' && g.parentId === undefined;

function stateTag(n: GoalNode): HTMLElement | null {
  const g = n.goal;
  if (g.unconfirmed) return h('span', { class: 'tag warn' }, 'подтверди сумму');
  if (g.status !== 'active') return h('span', { class: g.status === 'done' ? 'tag good' : 'tag' }, STATUS_LABELS[g.status]);
  if (n.achieved) return h('span', { class: 'tag good' }, 'набрано');
  return null;
}

// ───────────────────────── подсветка новой цели ─────────────────────────

let flash: { ids: string[]; until: number } | null = null;
function flashGoal(id: string): void {
  flashGoals([id]);
}
/** Подсветить цели при следующей отрисовке «Целей» (новая цель, метки после распределения дохода). */
export function flashGoals(ids: string[]): void {
  flash = { ids, until: Date.now() + 2500 };
}

// ───────────────────────── форма цели ─────────────────────────

/**
 * Три поля: название, сумма, срок (D96). Папка — если есть папки. Остальное — под «Подробнее».
 * Срок — дедлайн: по нему считается, сколько откладывать в месяц и успеваешь ли.
 */
function goalForm(id: string, g: Partial<Goal>, goals: Goal[], opts: { withReason: boolean }): { form: HTMLFormElement; read: () => { patch: Partial<Goal>; errs: string[] } } {
  const title = h('input', { name: 'title', required: true, value: g.title ?? '', placeholder: 'Например: отпуск, ноутбук, курсы', autocomplete: 'off' });
  const amount = moneyInput('targetMin', g.targetMin && g.targetMin > 0 ? g.targetMin : undefined);
  const when = h('input', { name: 'deadline', type: 'date', value: g.deadline ?? '' });
  const folders = goals.filter((x) => x.folder && x.id !== g.id && x.status !== 'cancelled');
  const flexSel = h('select', { name: 'flexibility' }, (Object.keys(FLEX) as Flexibility[]).map((f) => h('option', { value: f, selected: f === (g.flexibility ?? 'flexible') }, FLEX[f])));
  const form = h(
    'form',
    { class: 'stack', id },
    field('Название', title),
    g.folder ? null : field('Сколько нужно, ₸', amount, g.targetRule ? 'считается по правилу подушки — можно задать вручную' : undefined),
    field('К какому сроку (необязательно)', when, 'со сроком — приложение скажет, успеваешь ли и сколько откладывать в месяц'),
    folders.length && !g.folder
      ? field('В папке', h('select', { name: 'parentId' }, h('option', { value: '' }, 'нет'), folders.map((x) => h('option', { value: x.id, selected: x.id === g.parentId }, x.title))))
      : null,
    h(
      'details',
      { class: 'fold', 'data-key': `${id}:more` },
      h('summary', null, 'Подробнее'),
      h(
        'div',
        { class: 'stack' },
        field('Срок', flexSel, 'жёсткий — позже нельзя; гибкий — можно сдвинуть'),
        g.folder ? null : field('Откладывать в месяц не меньше, ₸', moneyInput('minMonthlyFunding', g.minMonthlyFunding, 'необязательно')),
        field('Зачем', h('input', { name: 'why', value: g.why ?? '', autocomplete: 'off' })),
      ),
    ),
    opts.withReason ? field('Почему меняешь (необязательно)', h('input', { name: 'reason', autocomplete: 'off' }), 'сохранится в истории цели') : null,
  );

  const read = () => {
    const errs: string[] = [];
    const targetMin = g.folder ? (0 as Money) : readMoney(form, 'targetMin');
    if (targetMin === null && !g.targetRule) errs.push('Сколько нужно: введи сумму');
    const opt = <T,>(v: T | '' | undefined | null): T | undefined => (v === '' || v === null || v === undefined ? undefined : v);
    let minMonthlyFunding: Money | undefined;
    if (readStr(form, 'minMonthlyFunding')) {
      const m = readMoney(form, 'minMonthlyFunding');
      if (m === null) errs.push('Откладывать в месяц: введи число или оставь пустым');
      minMonthlyFunding = m ?? undefined;
    }
    return {
      errs,
      patch: {
        title: readStr(form, 'title'),
        targetMin: (targetMin ?? g.targetMin ?? 0) as Money,
        deadline: opt(readStr(form, 'deadline')),
        flexibility: (readStr(form, 'flexibility') || 'flexible') as Flexibility,
        minMonthlyFunding,
        parentId: g.folder ? undefined : folders.length ? opt(readStr(form, 'parentId')) : g.parentId,
        why: readStr(form, 'why'),
      },
    };
  };
  return { form, read };
}

defineSheet('goal-new', (arg) => {
  const st = getState();
  const err = h('div');
  const folder = arg === 'folder';
  const { form, read } = goalForm('goal-new-form', folder ? { folder: true } : {}, st.goals, { withReason: false });
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const { patch, errs } = read();
    if (errs.length) return err.replaceChildren(errorsBox(errs) ?? '');
    const cur = getState().goals;
    const r = createGoal(
      { ...patch, id: newId(folder ? 'folder' : 'goal'), title: patch.title!, role: 'capital', targetMin: patch.targetMin!, importance: 3, order: nextOrder(cur, patch.parentId), ...(folder ? { folder: true as const } : {}) },
      cur,
      today(),
    );
    if (!r.ok) return err.replaceChildren(errorsBox([r.error]) ?? '');
    const id = r.value.id;
    flashGoal(id);
    await update((s) => ({ ...s, goals: [...s.goals, r.value] }));
    closeSheet();
    toast(folder ? `Папка «${r.value.title}» создана — добавь в неё цели` : `Цель «${r.value.title}» создана`, folder ? {} : { action: { label: 'Закрепить деньги', run: () => openSheet('goal-fund', id) } });
  });
  return {
    title: folder ? 'Новая папка' : 'Новая цель',
    body: h('div', { class: 'stack' }, folder ? h('p', { class: 'muted' }, 'Папка объединяет цели: у неё общий баланс, а у каждой цели внутри — свой. Срок папки действует на все цели в ней.') : null, form, err),
    bar: stickyBar(null, h('button', { class: 'btn primary', type: 'submit', form: 'goal-new-form' }, folder ? 'Создать папку' : 'Создать цель')),
  };
});

// ───────────────────────── подушка ─────────────────────────

type CushionMode = 'essential' | 'all' | 'custom';

defineSheet('cushion', () => {
  const st = getState();
  const o = ov();
  const g = st.goals.find((x) => isCushion(x) && x.status !== 'cancelled');
  const shown = o.goals.find((x) => x.id === g?.id);
  let mode: CushionMode = g ? (g.targetRule ? (g.targetRule.basis ?? 'essential') : 'custom') : 'essential';
  let months = g?.targetRule?.months ?? st.settings.reserveMonths;
  const ess = o.spend.usualMonthly - o.spend.regularMedian + o.spend.obligationsMonthly;
  const all = o.spend.usualMonthly + o.spend.obligationsMonthly;
  const amount = moneyInput('custom', g && !g.targetRule ? g.targetMin : undefined);
  const monthsIn = h('input', { name: 'months', type: 'number', min: 1, max: 24, inputmode: 'numeric', value: String(months) });
  const preview = h('div', { class: 'card stack' });
  const modeBox = h('div');
  const draw = () => {
    months = Math.max(1, Math.min(24, Number(monthsIn.value) || 3));
    const per = mode === 'all' ? all : ess;
    modeBox.replaceChildren(
      seg([['essential', 'Обязательное + жизнь'], ['all', 'Все обычные траты'], ['custom', 'Своя сумма']] as const, mode, (v) => ((mode = v), draw()), 'Из чего подушка'),
    );
    amount.closest('label')?.toggleAttribute('hidden', mode !== 'custom');
    monthsIn.closest('label')?.toggleAttribute('hidden', mode === 'custom');
    preview.replaceChildren(
      ...(mode === 'custom'
        ? [h('strong', null, 'Своя сумма'), h('div', { class: 'muted' }, 'Подушка не пересчитывается сама — сумму меняешь ты.')]
        : [
            h('strong', null, `${months} мес. × ${fmt(per as Money)} = ${fmt((per * months) as Money)}`),
            h('div', { class: 'muted' }, mode === 'all' ? 'В месяц: повседневные и регулярные траты + платежи по долгам. Пересчитывается сама.' : 'В месяц: повседневные траты (еда, дорога, связь, быт) + платежи по долгам. Пересчитывается сама.'),
          ]),
    );
  };
  const form = h('form', { id: 'cushion-form', class: 'stack' }, modeBox, field('На сколько месяцев', monthsIn), field('Сумма подушки, ₸', amount), preview);
  monthsIn.addEventListener('input', draw);
  queueMicrotask(draw);
  draw();
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const custom = readMoney(form, 'custom');
    if (mode === 'custom' && (custom === null || custom <= 0)) return toast('Введи сумму подушки', 'error');
    const rule = mode === 'custom' ? undefined : { kind: 'months_of_base' as const, months, basis: mode };
    await act((s) => {
      const cur = s.goals.find((x) => isCushion(x) && x.status !== 'cancelled');
      if (!cur) {
        const base = starterGoals(today())[0]!;
        const id = s.goals.some((x) => x.id === base.id) ? newId('goal') : base.id;
        const next: Goal = { ...base, id, title: 'Подушка', order: 0, ...(rule ? { targetRule: rule } : { targetMin: custom! }) };
        if (!rule) delete next.targetRule;
        return { ...s, goals: [...s.goals, next] };
      }
      const next: Goal = { ...cur, order: cur.order ?? 0, history: [...cur.history, { date: today(), field: 'targetRule', from: cur.targetRule ?? cur.targetMin, to: rule ?? custom, reason: 'подушка изменена' }] };
      if (rule) next.targetRule = rule;
      else {
        delete next.targetRule;
        next.targetMin = custom!;
      }
      return { ...s, goals: s.goals.map((x) => (x.id === cur.id ? next : x)) };
    }, g ? 'Подушка изменена' : 'Подушка создана');
    closeSheet();
  });
  return {
    title: 'Подушка',
    body: h(
      'div',
      { class: 'stack' },
      h('p', { class: 'muted' }, 'Запас на случай, если доход пропадёт. По умолчанию копится первой — на «Целях» её можно подвинуть ниже.'),
      shown && shown.targetMin > 0 ? h('p', null, `Сейчас: ${fmt(shown.targetMin)}`) : null,
      form,
    ),
    bar: stickyBar(null, h('button', { class: 'btn primary', type: 'submit', form: 'cushion-form' }, g ? 'Сохранить' : 'Создать подушку')),
  };
});

// ───────────────────────── распределить свободное в копилках ─────────────────────────

defineSheet('distribute', () => {
  const o = ov();
  const free = unassignedSavings(o);
  const plan = distributeSavings(o, today(), 'dist');
  const title = (id: string) => o.goals.find((g) => g.id === id)?.title ?? id;
  const entries = Object.entries(plan.byGoal).filter(([, v]) => v > 0);
  return {
    title: 'Распределить копилки',
    body: h(
      'div',
      { class: 'stack' },
      h('p', null, `В копилках не распределено по целям: `, h('strong', null, fmt(free))),
      entries.length
        ? [h('p', { class: 'muted' }, 'По порядку списка: подушка, потом цели сверху вниз — каждая до своей суммы.'), rows(entries.map(([id, v]) => row({ title: title(id), value: fmt(v) })))]
        : h('p', { class: 'muted' }, 'Всем целям уже хватает — остаток остаётся в копилках.'),
    ),
    bar: entries.length
      ? stickyBar(null, h('button', {
          class: 'btn primary',
          type: 'button',
          onclick: async () => {
            const p = distributeSavings(ov(), today(), newId('dist'));
            closeSheet();
            flashGoals(Object.keys(p.byGoal));
            await act((s) => ({ ...s, fundings: [...s.fundings, ...p.fundings] }), 'Распределено по целям');
          },
        }, 'Распределить'))
      : undefined,
  };
});

/**
 * «Перенести в подушку» (D122): подушка пуста или не добрана, а деньги на счетах есть, только числятся за другими целями.
 * Порядок целей метки не меняет, поэтому плашку «Подушка: 0 ₸ из …» убирает только перенос — или ответ «так задумано».
 * Предпросмотр: откуда сколько и как сдвинутся даты остальных целей; ничего не меняется, пока не нажата кнопка.
 */
defineSheet('cushion-fill', () => {
  const st = getState();
  const t = today();
  const fill = cushionFill(st, t, 'preview');
  if (!fill) return { title: 'Перенести в подушку', body: h('p', { class: 'muted' }, 'Переносить нечего: подушка набрана, а свободных денег в копилках и закреплённого за другими целями нет.') };
  const after = { ...st, fundings: [...st.fundings, ...fill.fundings] };
  const shifts = goalShifts(st, t, baseForecast(st, t, 36), baseForecast(after, t, 36)).filter((x) => x.goalId !== fill.cushionId);
  const word = (m: string | null) => (m ? monthWord(m) : 'не набирается');
  const answer = () => void act((s) => ({ ...s, settings: { ...s.settings, sanityAnswered: [...new Set([...(s.settings.sanityAnswered ?? []), 'cushion_ignores_money'])] } }), 'Записано: так задумано').then(() => closeSheet());
  return {
    title: 'Перенести в подушку',
    body: h(
      'div',
      { class: 'stack' },
      h('p', null, `Подушке не хватает ${fmt(fill.need)}. Деньги на счетах никуда не переводятся — меняется только то, за какой целью они числятся.`),
      sub('Откуда взять'),
      rows(
        [
          fill.fromFree > 0 ? row({ title: 'Свободные деньги в копилках', value: `−${fmt(fill.fromFree)}` }) : null,
          ...fill.fromGoals.map((x) => row({ title: x.title, value: `−${fmt(x.amount)}` })),
          row({ title: h('strong', null, 'В подушку'), value: h('strong', null, `+${fmt(fill.moved)}`) }),
        ].filter((x): x is HTMLElement => x !== null),
      ),
      fill.moved < fill.need ? h('p', { class: 'muted' }, `Этого хватает не на всю подушку: останется ${fmt((fill.need - fill.moved) as Money)}.`) : null,
      shifts.length
        ? h('div', { class: 'stack tight' }, h('strong', null, 'Что получат остальные цели'), ...shifts.slice(0, 4).map((x) => h('div', null, `${x.title}: ${word(x.from)} → ${word(x.to)}`)))
        : h('p', { class: 'muted' }, 'Даты других целей не меняются.'),
      h('button', { class: 'btn wide', type: 'button', onclick: answer }, 'Оставить как есть — так задумано'),
    ),
    bar: stickyBar(
      null,
      h('button', {
        class: 'btn primary',
        type: 'button',
        onclick: async () => {
          const f = cushionFill(getState(), today(), newId('cf'));
          closeSheet();
          if (!f) return;
          flashGoals([f.cushionId]);
          await act((s) => ({ ...s, fundings: [...s.fundings, ...f.fundings] }), `В подушку перенесено ${fmt(f.moved)}`);
        },
      }, 'Перенести'),
    ),
  };
});

// ───────────────────────── карточки и экран ─────────────────────────

function verdictLine(g: Goal, vd: ReturnType<typeof verdicts>): { tag: HTMLElement | null; lines: string[] } {
  const v = vd.get(g.id);
  if (!v) return { tag: g.deadline ? null : h('span', { class: 'gs' }, 'без срока'), lines: [] };
  if (v.remaining === 0) return { tag: h('span', { class: 'ok' }, 'готово'), lines: [] };
  if (v.ok) return { tag: h('span', { class: 'ok' }, 'успеваешь'), lines: [`откладывай ≈ ${fmt(v.perMonth)} в месяц`] };
  const shift = v.reachMonth ? ` — или сдвинь на ${monthWord(v.reachMonth)}` : '';
  return { tag: h('span', { class: 'bad' }, 'не успеваешь'), lines: [`нужно ещё ${fmt(v.extraPerMonth)} в месяц${shift}`] };
}

function progressBar(n: GoalNode): HTMLElement {
  const width = Math.min(100, n.pctPermille / 10);
  return h('div', { class: `progress${n.achieved ? ' done' : ''}`, role: 'progressbar', 'aria-valuemin': '0', 'aria-valuemax': '100', 'aria-valuenow': String(Math.round(width)), 'aria-label': `Прогресс «${n.goal.title}»` }, h('span', { style: `width:${width}%` }));
}

function goalCard(n: GoalNode, vd: ReturnType<typeof verdicts>): HTMLElement {
  const g = n.goal;
  const dim = g.status !== 'active';
  const fl = flash && flash.ids.includes(g.id) && Date.now() < flash.until ? ' flash' : '';
  if (g.folder || n.children.length) {
    // срок и вердикт папки — по её целям: успевают все — «успеваешь»
    const kids = n.children.map((c) => vd.get(c.goal.id)).filter((x): x is NonNullable<typeof x> => !!x);
    const bad = kids.filter((k) => !k.ok);
    const per = kids.reduce((a, k) => a + k.perMonth, 0);
    const tag = g.deadline ? (bad.length ? h('span', { class: 'bad' }, 'не успеваешь') : h('span', { class: 'ok' }, 'успеваешь')) : null;
    return h(
      'div',
      { class: `gcard folder${dim ? ' dim' : ''}${fl}`, 'data-goal': g.id },
      h('a', { class: 'gh', href: sheetHref('goal', g.id) }, h('span', { class: 'gt' }, g.title, h('span', { class: 'gs' }, ' · папка')), tag),
      h('div', { class: 'gs' }, `${fmt(n.progress)} из ${fmt(g.targetMin)}${g.deadline ? ` · ${deadlineText(g)}` : ''}${g.splitEqually ? ' · поровну' : ''}`),
      progressBar(n),
      g.deadline && !bad.length && per > 0 ? h('div', { class: 'gs' }, `откладывай ≈ ${fmt(per as Money)} в месяц`) : null,
      bad.length ? h('div', { class: 'gs' }, `нужно ещё ${fmt(bad.reduce((a, k) => a + k.extraPerMonth, 0) as Money)} в месяц`) : null,
      n.children.length
        ? h('div', { class: 'kids' }, n.children.map((c) => h('a', { href: sheetHref('goal', c.goal.id), 'data-goal': c.goal.id }, h('span', null, c.goal.title), h('span', { class: 'gs' }, `${fmt(c.progress)} из ${fmt(c.goal.targetMin)}`))))
        : h('div', { class: 'gs' }, 'пусто — добавь цель и выбери эту папку'),
    );
  }
  const vl = verdictLine(g, vd);
  const wait = !g.deadline && !isCushion(g) && n.remainingMin > 0 ? 'начнёт копиться, когда хватит на цели со сроком' : null;
  return h(
    'a',
    { class: `gcard${dim ? ' dim' : ''}${fl}`, href: sheetHref('goal', g.id), 'data-goal': g.id },
    h('div', { class: 'gh' }, h('span', { class: 'gt' }, g.title), g.status !== 'active' ? h('span', { class: 'gs' }, STATUS_LABELS[g.status]) : vl.tag),
    progressBar(n),
    h('div', { class: 'gs' }, `${fmt(n.progress)} из ${fmt(g.targetMin)}${g.deadline ? ` · ${deadlineText(g)}` : ''}`),
    vl.lines.map((l) => h('div', { class: 'gs' }, l)),
    wait && g.status === 'active' && !vl.lines.length ? h('div', { class: 'gs' }, wait) : null,
  );
}

function cushionCard(n: GoalNode | undefined): HTMLElement {
  if (!n)
    return h(
      'a',
      { class: 'gcard', href: sheetHref('cushion') },
      h('div', { class: 'gh' }, h('span', { class: 'gt' }, 'Подушки нет'), h('span', { class: 'bad' }, 'создать')),
      h('div', { class: 'gs' }, 'запас на 3 месяца на случай, если доход пропадёт'),
    );
  const g = n.goal;
  const months = g.targetRule ? `${g.targetRule.months ?? getState().settings.reserveMonths} мес.` : 'своя сумма';
  // сумма по правилу, а данных о тратах нет — не «0 из 0», а честно «пока не посчитать» (D103)
  if (g.targetMin <= 0)
    return h(
      'div',
      { class: 'gcard', 'data-goal': g.id },
      h('a', { class: 'gh', href: sheetHref('goal', g.id) }, h('span', { class: 'gt' }, `Подушка · ${months}`), h('span', { class: 'bad' }, 'не посчитать')),
      h('div', { class: 'gs' }, 'Не хватает данных о тратах. Проверь ', h('a', { href: '#/baskets' }, 'раскладку трат'), ' или ', h('a', { href: sheetHref('cushion') }, 'задай сумму сам ›')),
    );
  const ready = g.targetMin > 0 && n.progress >= g.targetMin;
  return h(
    'div',
    { class: 'gcard', 'data-goal': g.id },
    h('a', { class: 'gh', href: sheetHref('goal', g.id) }, h('span', { class: 'gt' }, `Подушка · ${months}`), ready ? h('span', { class: 'ok' }, 'готова') : h('span', { class: 'gs' }, `осталось ${fmt(n.remainingMin)}`)),
    progressBar(n),
    h('div', { class: 'gs' }, `${fmt(n.progress)} из ${fmt(g.targetMin)} · `, h('a', { href: sheetHref('cushion') }, 'сумма и срок ›')),
  );
}

let reordering = false;
/** Даты целей на момент, когда включили «Порядок» (D114): показываем, что сдвинулось от перестановок. */
let orderStart: Record<string, string | null> | null = null;

async function move(ids: string[], id: string, dir: -1 | 1): Promise<void> {
  const i = ids.indexOf(id);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= ids.length) return;
  const next = [...ids];
  [next[i], next[j]] = [next[j]!, next[i]!];
  await update((s) => ({ ...s, goals: reorderGoals(s.goals, next) }));
}

registerExplain('goals', 'Как посчитано: «Цели»', () => view().explanation);

export function renderGoals(): HTMLElement {
  const v = view();
  const st = getState();
  const o = ov();
  const hasData = o.hasData;
  const root = h('div', { class: 'screen' });

  // назначено больше, чем есть на счёте: красный блок с готовыми вариантами
  for (const x of v.overAssigned) {
    const acc = v.accounts.find((a) => a.accountId === x.accountId);
    root.append(
      h(
        'div',
        { class: 'badline stack' },
        h('div', null, `«${acc?.title ?? x.accountId}»: ${x.text}.`, info('overAssigned')),
        h(
          'div',
          { class: 'btn-row' },
          x.options.map((y) =>
            h(
              'button',
              {
                class: 'btn',
                type: 'button',
                onclick: async () => {
                  const r = withdrawMoney({ id: newId('fund'), goalId: y.goalId, accountId: x.accountId, amount: y.amount, date: today(), decisionId: null, note: 'закреплено больше, чем есть' }, { goals: v.goals, fundings: st.fundings, balances: v.balances });
                  if (!r.ok) return toast(r.error, 'error');
                  await act((s) => ({ ...s, fundings: [...s.fundings, r.value] }), `Снято ${fmt(y.amount)} с «${y.title}»`);
                },
              },
              `Снять ${fmt(y.amount)} с «${y.title}»`,
            ),
          ),
        ),
      ),
    );
  }

  if (hasData) {
    const free = unassignedSavings(o);
    append(root, [
      h(
        'div',
        { class: 'cells' },
        h('a', { class: 'cell', href: '#/accounts' }, h('div', { class: 'k' }, 'В копилках'), h('div', { class: 'v' }, fmt(o.spend.inSavings))),
        h('div', { class: 'cell' }, h('div', { class: 'k' }, 'Отложено на цели', info('assigned')), h('div', { class: 'v' }, fmt(v.totalAssigned))),
      ),
      free > 0 && st.goals.some((g) => g.status === 'active' && !g.folder)
        ? rows(row({ title: `${fmt(free)} в копилках не распределены`, sub: 'распределить по порядку одним нажатием', href: sheetHref('distribute') }))
        : null,
    ]);
  } else root.append(h('p', { class: 'one-line' }, 'Балансы целей появятся после ', h('a', { href: '#/import' }, 'загрузки бэкапа'), '.'));

  const vd = hasData ? verdicts() : new Map();
  const cushion = v.tree.find((n) => isCushion(n.goal) && n.goal.status !== 'cancelled');
  // подушка — в общем списке: по умолчанию первая, но её можно подвинуть (D100)
  if (!cushion) root.append(cushionCard(undefined));

  const list = v.tree.filter((n) => n.goal.status !== 'cancelled' && n.goal.status !== 'done');
  const card = (n: GoalNode) => (n === cushion ? cushionCard(n) : goalCard(n, vd));
  const ids = list.map((n) => n.goal.id);
  if (list.length) {
    append(root, [
      sub('Цели', list.length > 1 ? h('button', { class: `btn${reordering ? ' primary' : ''}`, type: 'button', onclick: () => ((reordering = !reordering), (orderStart = reordering ? { ...forecastNow().goalDates } : null), refresh()) }, reordering ? 'Готово' : '↑↓ Порядок') : null),
      reordering && orderStart ? orderShift(list.map((n) => n.goal)) : null,
      h('p', { class: 'one-line' }, reordering ? 'Двигай стрелками. Кто выше — получает деньги раньше, и подушка тоже.' : 'Кто выше — получает деньги раньше. Порядок можно менять.'),
      h(
        'div',
        { class: 'goal-stack' },
        list.map((n) =>
          reordering
            ? h(
                'div',
                { class: 'order-row' },
                card(n),
                h(
                  'div',
                  { class: 'order-btns' },
                  h('button', { class: 'btn', type: 'button', 'aria-label': `«${n.goal.title}» выше`, disabled: ids[0] === n.goal.id, onclick: () => void move(ids, n.goal.id, -1) }, '↑'),
                  h('button', { class: 'btn', type: 'button', 'aria-label': `«${n.goal.title}» ниже`, disabled: ids[ids.length - 1] === n.goal.id, onclick: () => void move(ids, n.goal.id, 1) }, '↓'),
                ),
              )
            : card(n),
        ),
      ),
    ]);
  } else if (!cushion || st.goals.length <= 1) {
    root.append(h('div', { class: 'card stack' }, h('strong', null, 'На что копишь?'), h('p', { class: 'muted' }, 'Цель — сумма, к которой копишь. Деньги остаются на счетах, за целью они просто закрепляются.')));
  }
  root.append(
    h('div', { class: 'stack' }, h('a', { class: 'btn primary wide', href: sheetHref('goal-new') }, '＋ Цель'), h('a', { class: 'btn wide', href: sheetHref('goal-new', 'folder') }, '＋ Папка')),
  );

  const closed = v.tree.filter((n) => n.goal.status === 'cancelled' || n.goal.status === 'done');
  root.append(
    h(
      'details',
      { class: 'fold', 'data-key': 'goals:details', open: st.settings.showDetails ? true : undefined },
      h('summary', null, 'Подробнее'),
      h(
        'div',
        { class: 'stack' },
        hasData ? h('p', { class: 'muted' }, `Всего отложено на цели ${fmt(v.totalAssigned)}`) : null,
        closed.length ? rows(closed.map((n) => row({ title: n.goal.title, sub: STATUS_LABELS[n.goal.status], href: sheetHref('goal', n.goal.id) }))) : null,
        new URLSearchParams(location.search).has('demo')
          ? h('button', { class: 'btn', type: 'button', onclick: () => act((s) => ({ ...s, goals: exampleGoals(today()) }), 'Созданы цели из примера — подтверди суммы') }, 'Создать пример целей')
          : null,
        st.goals.length
          ? confirmButton('Удалить все цели', 'Удалить', () => update((s) => ({ ...s, goals: [], fundings: [] })).then(() => toast('Цели удалены')), 'danger link', 'Все цели и отложенные на них суммы пропадут вместе с историей. Деньги на счетах не изменятся.')
          : null,
      ),
    ),
  );

  // новая цель: прокрутить к ней и подсветить
  if (flash && Date.now() < flash.until) {
    const id = flash.ids[0];
    if (id) setTimeout(() => document.querySelector(`[data-goal="${id}"]`)?.scrollIntoView({ block: 'center', behavior: 'smooth' }), 80);
  }
  return root;
}

// ───────────────────────── подэкран цели: действия ─────────────────────────

defineSheet('goal', (id) => {
  const v = view();
  const n = nodeOf(v, id);
  if (!n) return null;
  const g = n.goal;
  const st = getState();
  const open = g.status !== 'cancelled' && g.status !== 'done';
  const funded = st.fundings.some((f) => f.goalId === g.id) && v.accounts.some((a) => st.fundings.some((f) => f.goalId === g.id && f.accountId === a.accountId));
  const bound = st.settings.accounts.some((a) => a.boundGoalId === g.id);
  const histN = g.history.length + st.fundings.filter((f) => f.goalId === g.id).length;
  const del = deleteGoal(g.id, { goals: st.goals, fundings: st.fundings, accounts: st.settings.accounts });

  const remove = async () => {
    if (!del.ok) return;
    const i = await ask({ title: `Удалить «${g.title}»?`, text: 'История цели пропадёт. Если хочешь её сохранить — смени статус на «отменена».', actions: [{ label: 'Удалить', kind: 'danger' }] });
    if (i !== 0) return;
    closeSheet();
    await act((s) => ({ ...s, goals: del.value.goals, fundings: del.value.fundings }), `Цель «${g.title}» удалена`);
  };

  if (g.folder || n.children.length) {
    const setSplit = (on: boolean) =>
      act((s) => ({ ...s, goals: s.goals.map((x) => (x.id === g.id ? (on ? { ...x, splitEqually: true as const } : (({ splitEqually: _s, ...rest }) => rest)(x)) : x)) }), on ? 'Цели без срока в папке делят деньги поровну' : 'Цели в папке — по порядку');
    return {
      title: `Папка «${g.title}»`,
      body: h(
        'div',
        { class: 'stack' },
        h('div', { class: 'card stack' }, h('strong', null, `${fmt(n.progress)} из ${fmt(g.targetMin)}`), h('div', { class: 'muted' }, `${deadlineText(g)} · целей: ${n.children.length}`)),
        rows(
          row({ title: 'Делить поровну', sub: 'деньги для целей без срока — поровну между целями папки, а не по порядку', value: toggle(!!g.splitEqually, (v) => void setSplit(v), 'Делить поровну'), chevron: false }),
          ...n.children.map((c) => row({ title: c.goal.title, sub: `${fmt(c.progress)} из ${fmt(c.goal.targetMin)}`, href: sheetHref('goal', c.goal.id) })),
          row({ title: 'Изменить название и срок', href: sheetHref('goal-edit', g.id) }),
        ),
        del.ok
          ? h('button', { class: 'btn danger wide', type: 'button', onclick: remove }, 'Удалить папку')
          : h('p', { class: 'muted' }, 'Удалить можно пустую папку: сначала перенеси цели из неё («Изменить» у цели → «В папке: нет»).'),
      ),
    };
  }
  return {
    title: g.title,
    body: h(
      'div',
      { class: 'stack' },
      h(
        'div',
        { class: 'card stack' },
        h('div', { class: 'gh' }, h('strong', null, `${fmt(n.progress)} из ${fmt(g.targetMin)}`), stateTag(n)),
        h('div', { class: `bar${n.achieved ? ' done' : ''}` }, h('span', { style: `width:${Math.min(100, n.pctPermille / 10)}%` })),
        h('div', { class: 'muted' }, `${percent(n)} · ${deadlineText(g)}`),
        n.remainingMin > 0 ? h('div', { class: 'muted' }, `осталось ${fmt(n.remainingMin)}`) : null,
        ...verdictLine(g, verdicts()).lines.map((l) => h('div', null, l)),
        n.direct !== n.progress ? h('div', { class: 'muted' }, `напрямую ${fmt(n.direct)}, остальное — в частях цели`) : null,
        g.targetRule ? h('div', { class: 'muted' }, 'сумма подушки считается сама — ', h('a', { href: sheetHref('cushion') }, 'изменить ›')) : null,
        g.why ? h('div', { class: 'muted' }, `Зачем: ${g.why}`) : null,
      ),
      rows(
        open ? row({ title: 'Отложить на цель', sub: 'из денег, которые уже на счёте', href: sheetHref('goal-fund', g.id) }) : null,
        funded ? row({ title: 'Снять или перенести', href: sheetHref('goal-unfund', g.id) }) : null,
        row({ title: 'Изменить', href: sheetHref('goal-edit', g.id) }),
        row({ title: bound ? 'Счёт привязан целиком' : 'Привязать счёт целиком', href: sheetHref('goal-bind', g.id) }),
        row({ title: 'Статус', value: STATUS_LABELS[g.status], href: sheetHref('goal-status', g.id) }),
        row({ title: 'История', value: String(histN), href: sheetHref('goal-history', g.id) }),
      ),
      del.ok
        ? h('button', { class: 'btn danger wide', type: 'button', onclick: remove }, 'Удалить цель')
        : h('p', { class: 'muted' }, `Удалить нельзя: ${del.error.replace(/\.$/, '').replace(/^./, (c) => c.toLowerCase())}. Можно сменить статус на «отменена» — история сохранится.`),
    ),
  };
});

// закрепить деньги: выбор счёта строками (бывший блок «Деньги на счетах»)
defineSheet('goal-fund', (id) => {
  const v = view();
  const n = nodeOf(v, id);
  if (!n) return null;
  const g = n.goal;
  // настоящие счета первыми, оценка сбережений вне MoneyManager — последней
  const estimate = new Set(ov().capital.accounts.filter((p) => p.source === 'savings_flow').map((p) => p.accountId));
  const avail = v.allAccounts.filter((a) => a.status === 'available').sort((a, b) => Number(estimate.has(a.accountId)) - Number(estimate.has(b.accountId)) || b.free - a.free);
  const other = v.allAccounts.filter((a) => a.status !== 'available' && a.status !== 'excluded');
  let acc = avail[0]?.accountId ?? '';
  const err = h('div');
  const amount = moneyInput('amount');
  const form = h('form', { id: 'goal-fund-form', class: 'stack' });
  const list = h('div', { class: 'rows', role: 'radiogroup', 'aria-label': 'Счёт' });
  const quick = h('div', { class: 'chips wrap' });
  const drawQuick = () => {
    const a = avail.find((x) => x.accountId === acc);
    const items: [string, Money][] = [];
    if (a && n.remainingMin > 0) items.push([`Сколько не хватает · ${fmt(Math.min(n.remainingMin, a.free) as Money)}`, Math.min(n.remainingMin, a.free) as Money]);
    if (a) items.push([`Всё, что не отложено · ${fmt(a.free)}`, a.free]);
    quick.replaceChildren(...items.map(([l, m]) => chip(l, false, () => (amount.value = String(Math.floor(m / 100))))));
  };
  const draw = () => {
    list.replaceChildren(
      ...avail.map((a) => row({ title: a.title, sub: `не отложено ${fmt(a.free)}${estimate.has(a.accountId) ? ' · оценка' : ''}`, value: a.accountId === acc ? '✓' : undefined, cls: a.accountId === acc ? 'on' : '', chevron: false, onClick: () => { acc = a.accountId; draw(); drawQuick(); } })),
    );
  };
  draw();
  drawQuick();
  form.append(sub('Со счёта'), avail.length ? list : h('p', { class: 'muted' }, 'На счетах всё уже отложено на цели.'), field('Сколько, ₸', amount), quick, err);
  if (other.length) form.append(h('details', { class: 'fold', 'data-key': 'fund:other' }, h('summary', null, `Почему нет других счетов (${other.length})`), rows(other.map((a) => row({ title: a.title, sub: a.reason, value: fmt(a.balance) })))));
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const m = readMoney(form, 'amount');
    if (m === null) return err.replaceChildren(errorsBox(['Введи сумму']) ?? '');
    const cur = view();
    const r = assignMoney({ id: newId('fund'), goalId: g.id, accountId: acc, amount: m, date: today(), decisionId: null }, { goals: cur.goals, fundings: withoutAuto(cur.fundings), balances: cur.balances });
    if (!r.ok) return err.replaceChildren(errorsBox([r.error]) ?? '');
    closeSheet();
    await act((s) => ({ ...s, fundings: [...s.fundings, r.value] }), `${fmt(m)} отложено на «${g.title}»`);
  });
  return {
    title: `Отложить на «${g.title}»`,
    body: h('div', { class: 'stack' }, h('p', { class: 'muted' }, 'Приложение ничего не переводит: деньги остаются на счёте, просто теперь они для этой цели. Отложить можно не больше, чем на счёте ещё не отложено.'), form),
    bar: avail.length ? stickyBar(null, h('button', { class: 'btn primary', type: 'submit', form: 'goal-fund-form' }, 'Отложить')) : undefined,
  };
});

defineSheet('goal-unfund', (id) => {
  const v = view();
  const st = getState();
  const g = v.goals.find((x) => x.id === id);
  if (!g) return null;
  const fundedAccs = v.accounts.filter((a) => st.fundings.some((f) => f.goalId === g.id && f.accountId === a.accountId));
  const err = h('div');
  const form = h(
    'form',
    { id: 'goal-unfund-form', class: 'stack' },
    field('Со счёта', h('select', { name: 'acc' }, fundedAccs.map((a) => h('option', { value: a.accountId }, a.title)))),
    field('Сколько, ₸', moneyInput('amount')),
    field('Что сделать', h('select', { name: 'mode' }, h('option', { value: 'withdraw' }, 'Снять с цели'), ...v.accounts.map((a) => h('option', { value: `move:${a.accountId}` }, `Перенести на «${a.title}»`))), 'перенос — когда ты сам перевёл деньги на другой счёт'),
    err,
  );
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const amount = readMoney(form, 'amount');
    if (amount === null) return err.replaceChildren(errorsBox(['Введи сумму']) ?? '');
    const acc = readStr(form, 'acc');
    const mode = readStr(form, 'mode');
    const cur = view();
    // снять можно только настоящую метку; перенос проверяет место на целевом счёте с учётом привязок (D59)
    const ctx = { goals: cur.goals, fundings: mode === 'withdraw' ? getState().fundings : cur.fundings, balances: cur.balances };
    const r = mode === 'withdraw'
      ? withdrawMoney({ id: newId('fund'), goalId: g.id, accountId: acc, amount, date: today(), decisionId: null }, ctx)
      : moveFunding({ id: newId('move'), goalId: g.id, fromAccountId: acc, toAccountId: mode.slice(5), amount, date: today(), decisionId: null }, ctx);
    if (!r.ok) return err.replaceChildren(errorsBox([r.error]) ?? '');
    const added = Array.isArray(r.value) ? r.value : [r.value];
    closeSheet();
    await act((s) => ({ ...s, fundings: [...s.fundings, ...added] }), mode === 'withdraw' ? `Снято ${fmt(amount)} с «${g.title}»` : 'Перенесено');
  });
  return { title: 'Снять или перенести', body: form, bar: stickyBar(null, h('button', { class: 'btn primary', type: 'submit', form: 'goal-unfund-form' }, 'Готово')) };
});

defineSheet('goal-edit', (id) => {
  const st = getState();
  const original = st.goals.find((x) => x.id === id);
  if (!original) return null;
  const shown = view().goals.find((x) => x.id === id) ?? original;
  const err = h('div');
  const { form, read } = goalForm('goal-edit-form', shown, st.goals, { withReason: true });
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const { patch, errs } = read();
    if (errs.length) return err.replaceChildren(errorsBox(errs) ?? '');
    // сумма подушки по правилу не перезаписывается вычисленным значением
    if (original.targetRule && patch.targetMin === shown.targetMin) patch.targetMin = original.targetMin;
    const r = updateGoal(original, { ...patch, unconfirmed: false }, readStr(form, 'reason') || 'изменено', today(), st.goals);
    if (!r.ok) return err.replaceChildren(errorsBox([r.error]) ?? '');
    closeSheet();
    await act((s) => ({ ...s, goals: s.goals.map((x) => (x.id === id ? r.value : x)) }), 'Цель изменена');
  });
  return { title: 'Изменить цель', body: h('div', { class: 'stack' }, form, err), bar: stickyBar(null, h('button', { class: 'btn primary', type: 'submit', form: 'goal-edit-form' }, 'Сохранить')) };
});

defineSheet('goal-status', (id) => {
  const st = getState();
  const g = st.goals.find((x) => x.id === id);
  if (!g) return null;
  const err = h('div');
  let status: GoalStatus = g.status;
  const list = h('div', { class: 'rows', role: 'radiogroup', 'aria-label': 'Статус' });
  const draw = () => list.replaceChildren(...(Object.keys(STATUS_LABELS) as GoalStatus[]).map((s) => row({ title: STATUS_LABELS[s], value: s === status ? '✓' : undefined, cls: s === status ? 'on' : '', chevron: false, onClick: () => { status = s; draw(); } })));
  draw();
  const form = h('form', { id: 'goal-status-form', class: 'stack' }, list, field('Почему', h('input', { name: 'reason', required: true, autocomplete: 'off' }), 'сохранится в истории цели'), err);
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const cur = getState();
    const r = changeStatus(cur.goals.find((x) => x.id === id)!, status, readStr(form, 'reason'), today(), { goals: cur.goals, fundings: cur.fundings });
    if (!r.ok) return err.replaceChildren(errorsBox([r.error]) ?? '');
    closeSheet();
    await act((s) => ({ ...s, goals: s.goals.map((x) => (x.id === id ? r.value : x)) }), `Статус: ${STATUS_LABELS[status]}`);
  });
  return { title: 'Статус цели', body: form, bar: stickyBar(null, h('button', { class: 'btn primary', type: 'submit', form: 'goal-status-form' }, 'Сменить')) };
});

// привязка счёта целиком (D59)
defineSheet('goal-bind', (id) => {
  const v = view();
  const st = getState();
  const g = v.goals.find((x) => x.id === id);
  if (!g) return null;
  const boundHere = st.settings.accounts.filter((a) => a.boundGoalId === g.id);
  const bindable = v.allAccounts.filter((a) => a.status === 'available' || a.status === 'empty' || a.status === 'fully_assigned');
  const title = (accId: string) => v.allAccounts.find((a) => a.accountId === accId)?.title ?? accId;
  const setBinding = (accountId: string, goalId: string | undefined, msg: string) =>
    act((s) => {
      const prev = s.settings.accounts.find((x) => x.accountId === accountId);
      const base = prev ?? { accountId, excluded: false, liquidity: { kind: 'instant' as const } };
      const { boundGoalId: _old, ...rest } = base;
      const next = { ...rest, reviewed: true, ...(goalId ? { boundGoalId: goalId } : {}) };
      return { ...s, settings: { ...s.settings, accounts: [...s.settings.accounts.filter((x) => x.accountId !== accountId), next].sort((x, y) => (x.accountId < y.accountId ? -1 : 1)) } };
    }, msg);
  return {
    title: 'Счёт целиком',
    body: h(
      'div',
      { class: 'stack' },
      h('p', { class: 'muted' }, 'Весь остаток счёта будет за этой целью и сам вырастет при пополнении. Подходит для отдельного счёта под цель — заначки, депозита.'),
      boundHere.length ? [sub('Привязан'), rows(boundHere.map((b) => row({ title: title(b.accountId), value: h('span', { class: 'chip' }, 'Отвязать'), onClick: () => void setBinding(b.accountId, undefined, 'Счёт отвязан') })))] : null,
      bindable.length
        ? [sub('Можно привязать'), rows(bindable.map((a) => row({ title: a.title, sub: fmt(a.balance), value: h('span', { class: 'chip' }, 'Привязать'), onClick: () => void setBinding(a.accountId, g.id, `«${a.title}» привязан к «${g.title}»`) })))]
        : h('p', { class: 'muted' }, 'Нет счетов, которые можно привязать: неучитываемые и уже привязанные к другим целям не подходят.'),
    ),
  };
});

const FIELD_LABELS: Record<string, string> = {
  created: 'создана', title: 'название', role: 'шаблон', targetMin: 'сумма', targetComfort: 'комфортная сумма', deadline: 'срок', desiredDate: 'желаемая дата',
  flexibility: 'гибкость срока', importance: 'важность', minMonthlyFunding: 'взнос в месяц', parentId: 'часть цели', why: 'зачем', doneCriteria: 'когда выполнена', status: 'статус', unconfirmed: 'сумма подтверждена',
};

defineSheet('goal-history', (id) => {
  const v = view();
  const st = getState();
  const g = st.goals.find((x) => x.id === id);
  if (!g) return null;
  const accTitle = (a: string) => v.allAccounts.find((x) => x.accountId === a)?.title ?? a;
  const show = (x: unknown) => (x === null || x === undefined || x === '' ? '—' : typeof x === 'number' && x > 1000 ? fmt(x as Money) : String(x));
  const items = [
    ...g.history.map((x) => ({ date: x.date, title: x.field === 'created' ? 'Создана' : `${FIELD_LABELS[x.field] ?? x.field}: ${show(x.from)} → ${show(x.to)}`, sub: x.field === 'created' ? '' : x.reason })),
    ...st.fundings.filter((f) => f.goalId === id).map((f) => ({ date: f.date, title: `${f.amount > 0 ? 'Отложено' : 'Снято'} ${fmt((f.amount > 0 ? f.amount : -f.amount) as Money)}`, sub: `${accTitle(f.accountId)} · ${f.decisionId ? 'по распределению дохода' : 'вручную'}` })),
  ].sort((a, b) => (a.date < b.date ? 1 : -1));
  return { title: `История «${g.title}»`, body: rows(items.map((i) => row({ title: i.title, sub: [fmtDate(i.date), i.sub].filter(Boolean).join(' · ') }))) };
});


/** «Резерв: май 2028 → март 2027» — как перестановка изменила даты (прогноз пересчитывается на каждый шаг). */
function orderShift(goals: readonly { id: string; title: string; role?: string; parentId?: string }[]): HTMLElement | null {
  const now = forecastNow().goalDates;
  const lines: HTMLElement[] = [];
  for (const g of goals) {
    if (!(g.id in now) || !orderStart || !(g.id in orderStart)) continue;
    const a = orderStart[g.id] ?? null;
    const b = now[g.id] ?? null;
    if (a === b) continue;
    lines.push(h('div', null, `${g.title}: ${a ? monthWord(a as never) : 'не набирается'} → ${b ? monthWord(b as never) : 'не набирается'}`));
  }
  return h('div', { class: 'advice stack tight', 'aria-live': 'polite' }, h('strong', null, lines.length ? 'Что сдвинулось от перестановки' : 'Пока всё как было'), ...lines.slice(0, 5));
}
