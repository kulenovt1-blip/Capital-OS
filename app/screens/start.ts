/**
 * Первый запуск (D96): три коротких шага после загрузки бэкапа, у каждого уже заполненный ответ и «Пропустить».
 *  1. Доходы — что нашлось в бэкапе («Зарплата ≈ 95 000 ₸, 5-го — верно?»).
 *  2. Какие счета — копилки (похожие по названию уже отмечены).
 *  3. На что копишь — подушка на 3 месяца создаётся сама, цели можно добавить или пропустить.
 */
import { SAVINGS_TITLE_RE, createGoal, detectNewIncomes, nextOrder, starterGoals, type AccountKind, type AppState, type IncomeCandidate } from '../../engine/index';
import { field, h, toast } from '../dom';
import { act, getState, today, update } from '../store';
import { ov } from '../ctx';
import { errorsBox, fmt, moneyInput, newId, readMoney, readStr, row, rows, toggle } from '../ui';
import { go, refresh } from '../main';
import { incomeList, incomeQuickForm } from '../blocks';

type Step = 'income' | 'savings' | 'goals';
const STEPS: Step[] = ['income', 'savings', 'goals'];

/** Выбор на шаге (до «Дальше»): какие найденные доходы добавить, какие счета — копилки. */
let incomePick: Map<string, boolean> | null = null;
let kindPick: Map<string, AccountKind> | null = null;

function dots(step: Step): HTMLElement {
  return h('div', { class: 'dots', 'aria-label': `Шаг ${STEPS.indexOf(step) + 1} из 3` }, STEPS.map((s) => h('i', { class: s === step ? 'on' : '' })));
}

function finish(): Promise<void> {
  return update((s) => withCushion({ ...s, settings: { ...s.settings, firstRunDone: true } })).then(() => {
    incomePick = null;
    kindPick = null;
    go('#/overview');
  });
}

/** Подушка на 3 месяца «обязательное + жизнь» создаётся сама, если её нет. */
function withCushion(s: AppState): AppState {
  if (s.goals.some((g) => g.role === 'safety' && g.parentId === undefined && g.status !== 'cancelled')) return s;
  const g = starterGoals(today())[0]!;
  const id = s.goals.some((x) => x.id === g.id) ? newId('goal') : g.id;
  return { ...s, goals: [...s.goals, { ...g, id, title: 'Подушка', order: 0 }] };
}

function nav(step: Step, next: () => void | Promise<void>, nextLabel = 'Дальше'): HTMLElement {
  const i = STEPS.indexOf(step);
  const skip = () => (i < 2 ? go(`#/start/${STEPS[i + 1]}`) : void finish());
  return h(
    'div',
    { class: 'stack' },
    h('button', { class: 'btn primary wide big', type: 'button', onclick: () => void next() }, nextLabel),
    h('button', { class: 'btn link', type: 'button', onclick: skip }, 'Пропустить'),
  );
}

function incomeStep(): HTMLElement {
  const st = getState();
  const found: IncomeCandidate[] = detectNewIncomes(st, today(), ov());
  incomePick ??= new Map(found.map((c) => [c.categoryId, true]));
  const pick = incomePick;
  const list = incomeList();
  return h(
    'div',
    { class: 'stack' },
    dots('income'),
    h('div', { class: 'q' }, 'Какие у тебя доходы?'),
    found.length
      ? [
          h('p', { class: 'one-line' }, 'Нашли в бэкапе — оставь включёнными те, что верны. Сумму и число можно поправить потом в «Ещё → Доходы».'),
          rows(found.map((c) => row({ title: c.title, sub: `≈ ${fmt(c.amount)}, около ${c.dayOfMonth}-го · ${c.months} мес. подряд`, value: toggle(pick.get(c.categoryId) ?? true, (v) => (pick.set(c.categoryId, v), refresh()), `Доход «${c.title}»`), chevron: false }))),
        ]
      : h('p', { class: 'one-line' }, 'Регулярных доходов в бэкапе не нашлось. Добавь, когда и сколько приходит — так приложение будет знать, до какого числа считать «Можно тратить».'),
    list ? [h('h3', { class: 'sub' }, h('span', null, 'Уже есть')), list] : null,
    found.length ? null : incomeQuickForm(() => refresh()),
    nav('income', async () => {
      const add = found.filter((c) => pick.get(c.categoryId) ?? true);
      if (add.length) {
        await act(
          (s) => ({ ...s, settings: { ...s.settings, incomeSchedule: [...s.settings.incomeSchedule, ...add.map((c) => ({ id: newId('inc'), title: c.title, dayOfMonth: c.dayOfMonth, amount: c.amount, kind: 'stable' as const }))], dismissedIncomes: [...(s.settings.dismissedIncomes ?? []), ...found.filter((c) => !add.includes(c)).map((c) => c.categoryId)] } }),
          `Доходов добавлено: ${add.length}`,
        );
      }
      go('#/start/savings');
    }),
  );
}

function savingsStep(): HTMLElement {
  const o = ov();
  const accs = o.capital.accounts.filter((p) => !p.excluded);
  kindPick ??= new Map(accs.map((p) => [p.accountId, o.spend.kinds[p.accountId] ?? 'spend']));
  const pick = kindPick;
  return h(
    'div',
    { class: 'stack' },
    dots('savings'),
    h('div', { class: 'q' }, 'Какие счета — копилки?'),
    h('p', { class: 'one-line' }, 'Копилки — то, что не тратишь: они не входят в «Можно тратить». Похожие по названию уже отмечены — поправь, если не так.'),
    rows(
      accs.map((p) => {
        const on = pick.get(p.accountId) === 'savings';
        const hint = SAVINGS_TITLE_RE.test(p.title) ? ' · похоже на копилку' : p.availableFrom > today() ? ' · снять можно позже' : '';
        return row({ title: p.title, sub: `${fmt(p.balance)}${hint}`, value: toggle(on, (v) => (pick.set(p.accountId, v ? 'savings' : 'spend'), refresh()), `«${p.title}» — копилка`), chevron: false });
      }),
    ),
    nav('savings', async () => {
      await update((s) => {
        const ids = new Set(s.settings.accounts.map((a) => a.accountId));
        const accounts = s.settings.accounts.map((a) => (pick.has(a.accountId) ? { ...a, kind: pick.get(a.accountId)! } : a));
        // ручные счета: настройка вида заводится отдельно
        for (const [id, kind] of pick) if (!ids.has(id)) accounts.push({ accountId: id, excluded: false, liquidity: { kind: 'instant' }, kind });
        return { ...s, settings: { ...s.settings, accounts: accounts.sort((x, y) => (x.accountId < y.accountId ? -1 : 1)) } };
      });
      go('#/start/goals');
    }),
  );
}

function goalsStep(): HTMLElement {
  const st = getState();
  const goals = st.goals.filter((g) => !(g.role === 'safety' && g.parentId === undefined) && g.status === 'active');
  const err = h('div');
  const form = h(
    'form',
    { class: 'stack' },
    field('Название', h('input', { name: 'title', placeholder: 'Например: отпуск, ноутбук', autocomplete: 'off' })),
    field('Сколько нужно, ₸', moneyInput('amount')),
    field('К какому сроку (необязательно)', h('input', { name: 'deadline', type: 'date' })),
    err,
    h('button', { class: 'btn wide', type: 'submit' }, '＋ Добавить цель'),
  );
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const title = readStr(form, 'title');
    const amount = readMoney(form, 'amount');
    const errs = [!title ? 'Напиши название' : '', amount === null || amount <= 0 ? 'Введи сумму' : ''].filter(Boolean);
    if (errs.length) return err.replaceChildren(errorsBox(errs) ?? '');
    const deadline = readStr(form, 'deadline');
    const cur = getState().goals;
    const r = createGoal({ id: newId('goal'), title, role: 'capital', targetMin: amount!, importance: 3, order: nextOrder(cur), ...(deadline ? { deadline } : {}) }, cur, today());
    if (!r.ok) return err.replaceChildren(errorsBox([r.error]) ?? '');
    await update((s) => ({ ...s, goals: [...s.goals, r.value] }));
    toast(`Цель «${title}» добавлена`);
  });
  return h(
    'div',
    { class: 'stack' },
    dots('goals'),
    h('div', { class: 'q' }, 'На что копишь?'),
    h('p', { class: 'one-line' }, 'Подушка на 3 месяца трат создастся сама и будет первой в списке — порядок можно поменять. Остальные цели можно добавить сейчас или потом.'),
    goals.length ? rows(goals.map((g) => row({ title: g.title, sub: g.deadline ? `к ${g.deadline.slice(8, 10)}.${g.deadline.slice(5, 7)}.${g.deadline.slice(0, 4)}` : 'без срока', value: fmt(g.targetMin) }))) : null,
    form,
    nav('goals', () => finish(), 'Готово'),
  );
}

export function renderStart(_rerender: () => void, section?: string): HTMLElement {
  const st = getState();
  const root = h('div', { class: 'screen' });
  if (!st.imported) {
    root.append(h('div', { class: 'card stack' }, h('strong', null, 'Сначала загрузи бэкап'), h('a', { class: 'btn primary wide', href: '#/import' }, 'Загрузить бэкап')));
    return root;
  }
  const step: Step = (STEPS as string[]).includes(section ?? '') ? (section as Step) : 'income';
  root.append(step === 'income' ? incomeStep() : step === 'savings' ? savingsStep() : goalsStep());
  return root;
}
