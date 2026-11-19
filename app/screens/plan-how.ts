/**
 * Путь к запасу (D123 «Из А в Б» → D217): раньше отдельный лист «Из А в Б» с кнопкой «Посчитать путь» рядом со ссылкой «Как выполнить» —
 * две двери в одно и то же. Теперь это часть одного листа «Как дойти» (`road-how` на «Профиле»); здесь — его блок про запас.
 * Ничего не считает: всё из `routeTo` (engine/roadmap.ts).
 */
import { cutEvent, higherTargets, routeTo, RESERVE_NOTES, ROUTE_DEADLINES, type ReserveTarget } from '../../engine/index';
import { h } from '../dom';
import { act, getState, today } from '../store';
import { reserveCtx, ov } from '../ctx';
import { fmt, monthTo, monthWord, newId, row, rows, seg, sub } from '../ui';
import { closeSheet, refresh, sheetHref } from '../main';

/** Куда человек хочет выйти (месяцев запаса) и за сколько месяцев — пока открыт лист. */
let routeTarget: ReserveTarget | null = null;
let routeDeadline = 6;
/** «План» на «Профиле», «Цели» и «Прогноз» открывают «Как дойти» сразу с нужной целью запаса. */
export function setRouteTarget(m: ReserveTarget | null): void {
  routeTarget = m;
}

/** Начало названия события «путь к запасу»: по нему план находится, заменяется и убирается. */
export const ROUTE_PLAN_PREFIX = 'Набрать ';

function monthKeyNext(t: string): string {
  const [y, m] = t.slice(0, 7).split('-').map(Number) as [number, number];
  const n = y * 12 + m;
  return `${Math.floor(n / 12)}-${String((n % 12) + 1).padStart(2, '0')}`;
}

const monthsWord = (m: number): string => (m === 12 ? 'год' : `${m} ${m === 1 ? 'месяц' : m < 5 ? 'месяца' : 'месяцев'}`);

/**
 * Блок «Запас»: сколько нужно и не хватает, к какому месяцу нынешним темпом, «хочу быстрее» с добавкой в план.
 * `preferred` — цель следующей ступени (3 или 6); человек может выбрать и другую из бо́льших. Пусто — запас уже на год и больше или данных нет.
 * `deficit` — сейчас минус: тогда «быстрее» не предлагается (любая добавка сначала закрывает дыру — это сказано шагом выше).
 */
export function reserveRouteParts(preferred: ReserveTarget | null, deficit: boolean): HTMLElement[] {
  const st = getState();
  const t = today();
  const stg = reserveCtx();
  if (!stg) return [];
  const ups = higherTargets(stg.coverMonths);
  if (!ups.length) return [h('div', { class: 'okline' }, 'Запас на год и больше: дальше — не про запас, а про цели.')];
  const want = routeTarget ?? preferred;
  const to = (want !== null && ups.includes(want) ? want : stg.next!.months) as ReserveTarget;
  const r = routeTo(st, t, to);
  if (!r) return [];
  const toText = `запас на ${monthsWord(to)}`;
  const pick = seg(ups.map((m) => [String(m), m === 12 ? 'год' : `${m} мес`] as const), String(to), (v) => ((routeTarget = Number(v) as ReserveTarget), refresh()), 'Какой запас нужен');

  const out: HTMLElement[] = [
    pick,
    h('p', { class: 'muted' }, RESERVE_NOTES[to]),
    rows(
      row({ title: 'Нужно', sub: `${to} × ${fmt(r.from.needMonthly)} необходимого в месяц`, value: fmt(r.target), chevron: false }),
      row({ title: 'Есть сейчас', sub: 'можно снять сразу', value: fmt(r.from.liquid), chevron: false }),
      row({ title: h('strong', null, 'Не хватает'), value: h('strong', null, fmt(r.missing)), chevron: false }),
    ),
  ];
  if (deficit) {
    out.push(h('p', null, 'Пока расходы больше доходов, запас не растёт — сначала шаг выше.'));
    return out;
  }
  out.push(h('p', null, r.by ? h('strong', null, `Нынешним темпом — к ${monthTo(r.by)}.`) : 'Нынешним темпом за пять лет не набирается: расходы почти равны доходам.'));
  if (r.debtFree) out.push(h('p', { class: 'muted' }, `Платежи по долгам кончатся к ${monthTo(r.debtFree.from)}: освободится ≈ ${fmt(r.debtFree.freed)} в месяц — это уже учтено.`));
  if (r.steps.length > 1) out.push(rows(r.steps.map((x) => row({ title: `Запас на ${monthsWord(x.months)}`, sub: `нужно ${fmt(x.target)}`, value: x.by ? monthWord(x.by) : 'не набирается', chevron: false }))));

  const dl = r.deadlines.find((d) => d.months === routeDeadline) ?? r.deadlines[0];
  const planned = st.settings.plannedEvents.find((e) => e.title.startsWith(ROUTE_PLAN_PREFIX));
  const usual = ov().spend.usualMonthly;
  out.push(sub('Хочу быстрее'), seg(ROUTE_DEADLINES.map((n) => [String(n), n === 12 ? 'год' : n === 24 ? '2 года' : `${n} мес`] as const), String(dl?.months ?? routeDeadline), (v) => ((routeDeadline = Number(v)), refresh()), 'За сколько месяцев'));
  if (dl) {
    if (planned) {
      out.push(
        h('div', { class: 'okline' }, `Уже в плане: «${planned.title}». Прогноз считает с этой добавкой.`),
        h('button', { class: 'btn wide', type: 'button', onclick: () => void act((x) => ({ ...x, settings: { ...x.settings, plannedEvents: x.settings.plannedEvents.filter((e) => !e.title.startsWith(ROUTE_PLAN_PREFIX)) } }), 'Убрано из плана').then(() => closeSheet()) }, 'Убрать из плана'),
      );
    } else if (dl.extraMonthly === 0) {
      out.push(h('div', { class: 'okline' }, `К ${monthTo(dl.month)} ты и так успеваешь — откладывать больше не нужно.`));
    } else {
      const title = `${ROUTE_PLAN_PREFIX}${toText} к ${monthTo(dl.month)}`;
      out.push(
        h('p', null, `Чтобы ${toText.replace('запас', 'набрать запас')} к ${monthTo(dl.month)}, откладывай сверху ≈ ${fmt(dl.extraMonthly)} в месяц${usual > 0 ? ` (${Math.round((dl.extraMonthly / usual) * 100)} % обычных трат)` : ''}. Меньше тратить или больше получать — для запаса одно и то же.`),
        h('button', { class: 'btn primary wide', type: 'button', onclick: () => void act((x) => ({ ...x, settings: { ...x.settings, plannedEvents: [...x.settings.plannedEvents.filter((e) => !e.title.startsWith(ROUTE_PLAN_PREFIX)), cutEvent(newId('ev'), `${monthKeyNext(t)}-01` as never, dl.extraMonthly, title)] } }), `В плане: откладывать на ${fmt(dl.extraMonthly)} в месяц больше — прогноз пересчитан`).then(() => closeSheet()) }, 'Добавить в план'),
      );
    }
  }
  out.push(h('a', { class: 'link', href: sheetHref('reserve-info'), style: 'display:flex;align-items:center;min-height:44px' }, 'Как посчитан запас ›'));
  return out;
}
