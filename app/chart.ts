/**
 * Линейный график капитала по сценариям: SVG без библиотек (Chart.js/uPlot недоступны — BLOCKERS B1).
 * Одна ось, линии 2px, легенда + подписи на концах, перекрестие с подсказкой, нулевая линия.
 * Цвета — слоты 1–3 валидированной категориальной палитры (CSS-переменные --series-N, светлая и тёмная тема).
 */
import { formatKZT, formatMonthRu, type Money, type MonthKey } from '../engine/index';
import { h } from './dom';

export interface Series {
  name: string;
  /** Номер слота палитры 1..3. */
  slot: 1 | 2 | 3;
  values: Money[];
  /** Короткая подпись на конце линии (узкий экран). */
  short?: string;
}

const NS = 'http://www.w3.org/2000/svg';
function s<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number>): SVGElementTagNameMap[K] {
  const el = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
  return el;
}

function compact(m: number): string {
  const t = m / 100;
  const a = Math.abs(t);
  if (a >= 1_000_000) return `${(t / 1_000_000).toFixed(1).replace('.', ',')} млн`;
  if (a >= 1_000) return `${Math.round(t / 1_000)} тыс`;
  return String(Math.round(t));
}

function niceTicks(lo: number, hi: number, n = 4): number[] {
  const span = hi - lo || 1;
  const raw = span / n;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const stepN = [1, 2, 2.5, 5, 10].map((k) => k * mag).find((k) => span / k <= n) ?? 10 * mag;
  const out: number[] = [];
  for (let v = Math.ceil(lo / stepN) * stepN; v <= hi + 1e-9; v += stepN) out.push(Math.round(v));
  return out;
}

export function lineChart(months: MonthKey[], series: Series[], title: string, width = 640): HTMLElement {
  // рисуем в реальных пикселях, чтобы текст не сжимался на телефоне
  const W = Math.max(280, Math.min(720, Math.round(width)));
  const narrow = W < 480;
  const H = narrow ? 220 : 260;
  const pad = { l: 48, r: narrow ? 46 : 96, t: 12, b: 28 };
  const all = series.flatMap((x) => x.values);
  let lo = Math.min(0, ...all);
  let hi = Math.max(0, ...all);
  if (lo === hi) hi = lo + 100;
  const ticks = niceTicks(lo, hi);
  lo = Math.min(lo, ticks[0]!);
  hi = Math.max(hi, ticks[ticks.length - 1]!);
  const x = (i: number) => pad.l + (i * (W - pad.l - pad.r)) / Math.max(1, months.length - 1);
  const y = (v: number) => pad.t + ((hi - v) * (H - pad.t - pad.b)) / (hi - lo);

  const svg = s('svg', { viewBox: `0 0 ${W} ${H}`, class: 'chart', role: 'img', 'aria-label': title });
  for (const t of ticks) {
    svg.append(s('line', { x1: pad.l, x2: W - pad.r, y1: y(t), y2: y(t), class: t === 0 ? 'zero' : 'grid' }));
    const lab = s('text', { x: pad.l - 6, y: y(t) + 4, 'text-anchor': 'end', class: 'axis' });
    lab.textContent = compact(t);
    svg.append(lab);
  }
  const every = Math.max(1, Math.ceil(months.length / (narrow ? 4 : 6)));
  months.forEach((m, i) => {
    const last = i === months.length - 1;
    if (i % every !== 0 && !last) return;
    // последняя подпись не должна наезжать на предыдущую
    if (last && i % every !== 0 && i - Math.floor(i / every) * every < every * 0.9) return;
    const lab = s('text', { x: x(i), y: H - 8, 'text-anchor': 'middle', class: 'axis' });
    lab.textContent = formatMonthRu(m);
    svg.append(lab);
  });
  // линии и подписи на концах (сдвигаются, чтобы не налезать)
  const ends: { y: number; sr: Series }[] = [];
  for (const sr of series) {
    const d = sr.values.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join('');
    svg.append(s('path', { d, class: `line s${sr.slot}` }));
    ends.push({ y: y(sr.values[sr.values.length - 1] ?? 0), sr });
  }
  ends.sort((a, b) => a.y - b.y);
  for (let i = 1; i < ends.length; i++) if (ends[i]!.y - ends[i - 1]!.y < 14) ends[i]!.y = ends[i - 1]!.y + 14;
  for (const e of ends) {
    const t = s('text', { x: W - pad.r + 6, y: e.y + 4, class: 'end-label' });
    t.textContent = narrow ? (e.sr.short ?? e.sr.name) : e.sr.name;
    svg.append(s('circle', { cx: W - pad.r, cy: y(e.sr.values[e.sr.values.length - 1] ?? 0), r: 3, class: `dot s${e.sr.slot}` }));
    svg.append(t);
  }
  // перекрестие и подсказка
  const cross = s('line', { y1: pad.t, y2: H - pad.b, class: 'cross', visibility: 'hidden' });
  svg.append(cross);
  const tip = h('div', { class: 'chart-tip', hidden: true });
  const hit = s('rect', { x: pad.l, y: pad.t, width: W - pad.l - pad.r, height: H - pad.t - pad.b, fill: 'transparent' });
  const move = (clientX: number) => {
    const r = svg.getBoundingClientRect();
    const vx = ((clientX - r.left) / r.width) * W;
    const i = Math.max(0, Math.min(months.length - 1, Math.round(((vx - pad.l) / (W - pad.l - pad.r)) * (months.length - 1))));
    cross.setAttribute('x1', String(x(i)));
    cross.setAttribute('x2', String(x(i)));
    cross.setAttribute('visibility', 'visible');
    tip.hidden = false;
    tip.replaceChildren(h('strong', null, formatMonthRu(months[i]!)), ...series.map((sr) => h('div', null, h('span', { class: `sw s${sr.slot}` }), `${sr.name}: ${formatKZT(sr.values[i] ?? (0 as Money))}`)));
    const left = (x(i) / W) * r.width;
    tip.style.left = `${Math.min(Math.max(0, left - 90), r.width - 180)}px`;
  };
  hit.addEventListener('pointermove', (e) => move(e.clientX));
  hit.addEventListener('pointerdown', (e) => move(e.clientX));
  hit.addEventListener('pointerleave', () => {
    cross.setAttribute('visibility', 'hidden');
    tip.hidden = true;
  });
  svg.append(hit);
  const legend = h('div', { class: 'legend' }, series.map((sr) => h('span', null, h('span', { class: `sw s${sr.slot}` }), sr.name)));
  return h('figure', { class: 'viz-root' }, h('figcaption', null, title), legend, h('div', { class: 'chart-wrap' }, svg, tip));
}

/**
 * Прогноз капитала (D87): база — сплошная линия, «хуже — лучше» — светлая полоса, метка «сегодня».
 * Подписи на концах теми же словами, что в легенде; если линии совпали, подпись одна — «База».
 */
export function bandChart(months: MonthKey[], base: Money[], worse: Money[], better: Money[], title: string, width = 640): HTMLElement {
  const W = Math.max(280, Math.min(720, Math.round(width)));
  const narrow = W < 480;
  const H = narrow ? 220 : 260;
  const all = [...base, ...worse, ...better];
  let lo = Math.min(0, ...all);
  let hi = Math.max(0, ...all);
  if (lo === hi) hi = lo + 100;
  const ticks = niceTicks(lo, hi);
  lo = Math.min(lo, ticks[0]!);
  hi = Math.max(hi, ticks[ticks.length - 1]!);
  // слева место под самую длинную подпись оси, справа — под «Лучше»
  const longest = Math.max(...ticks.map((t) => compact(t).length));
  const pad = { l: 14 + longest * 7, r: 52, t: 22, b: 28 };
  const n = months.length;
  const x = (i: number) => pad.l + (i * (W - pad.l - pad.r)) / Math.max(1, n - 1);
  const y = (v: number) => pad.t + ((hi - v) * (H - pad.t - pad.b)) / (hi - lo);

  const svg = s('svg', { viewBox: `0 0 ${W} ${H}`, class: 'chart', role: 'img', 'aria-label': title });
  for (const t of ticks) {
    svg.append(s('line', { x1: pad.l, x2: W - pad.r, y1: y(t), y2: y(t), class: t === 0 ? 'zero' : 'grid' }));
    const lab = s('text', { x: pad.l - 6, y: y(t) + 4, 'text-anchor': 'end', class: 'axis' });
    lab.textContent = compact(t);
    svg.append(lab);
  }
  // подписи месяцев не ближе ~76 px друг к другу
  const every = Math.max(1, Math.ceil((76 * (n - 1)) / Math.max(1, W - pad.l - pad.r)));
  months.forEach((m, i) => {
    const last = i === n - 1;
    if (i === 0) return; // на первой точке — «сегодня»
    if (i % every !== 0 && !last) return;
    if (last && i % every !== 0 && i - Math.floor(i / every) * every < every * 0.9) return;
    const lab = s('text', { x: x(i), y: H - 8, 'text-anchor': 'middle', class: 'axis' });
    lab.textContent = formatMonthRu(m);
    svg.append(lab);
  });
  const hiSide = worse.map((w, i) => Math.max(w, better[i] ?? w, base[i] ?? w));
  const loSide = worse.map((w, i) => Math.min(w, better[i] ?? w, base[i] ?? w));
  const band = [...hiSide.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`), ...loSide.map((v, i) => [i, v] as const).reverse().map(([i, v]) => `L${x(i).toFixed(1)},${y(v).toFixed(1)}`), 'Z'].join('');
  svg.append(s('path', { d: band, class: 'band' }));
  svg.append(s('path', { d: base.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(''), class: 'line s1' }));
  // сегодня
  svg.append(s('line', { x1: x(0), x2: x(0), y1: pad.t - 6, y2: H - pad.b, class: 'today' }));
  const td = s('text', { x: x(0) + 4, y: pad.t - 10, class: 'today-label' });
  td.textContent = 'сегодня';
  svg.append(td);
  // подписи на концах
  const end = (arr: Money[]) => y(arr[n - 1] ?? 0);
  const yb = end(base);
  const same = Math.abs(end(worse) - yb) < 3 && Math.abs(end(better) - yb) < 3;
  const labels = same ? [{ y: yb, t: 'База' }] : [{ y: end(better), t: 'Лучше' }, { y: yb, t: 'База' }, { y: end(worse), t: 'Хуже' }].sort((a, b) => a.y - b.y);
  for (let i = 1; i < labels.length; i++) if (labels[i]!.y - labels[i - 1]!.y < 14) labels[i]!.y = labels[i - 1]!.y + 14;
  for (const l of labels) {
    const t = s('text', { x: W - pad.r + 6, y: l.y + 4, class: 'end-label' });
    t.textContent = l.t;
    svg.append(t);
  }
  svg.append(s('circle', { cx: x(n - 1), cy: yb, r: 3, class: 'dot s1' }));
  // перекрестие и подсказка
  const cross = s('line', { y1: pad.t, y2: H - pad.b, class: 'cross', visibility: 'hidden' });
  svg.append(cross);
  const tip = h('div', { class: 'chart-tip', hidden: true });
  const hit = s('rect', { x: pad.l, y: pad.t, width: W - pad.l - pad.r, height: H - pad.t - pad.b, fill: 'transparent' });
  const move = (clientX: number) => {
    const r = svg.getBoundingClientRect();
    const vx = ((clientX - r.left) / r.width) * W;
    const i = Math.max(0, Math.min(n - 1, Math.round(((vx - pad.l) / (W - pad.l - pad.r)) * (n - 1))));
    cross.setAttribute('x1', String(x(i)));
    cross.setAttribute('x2', String(x(i)));
    cross.setAttribute('visibility', 'visible');
    tip.hidden = false;
    tip.replaceChildren(
      h('strong', null, formatMonthRu(months[i]!)),
      h('div', null, `Лучше: ${formatKZT(better[i] ?? (0 as Money))}`),
      h('div', null, h('span', { class: 'sw s1' }), `База: ${formatKZT(base[i] ?? (0 as Money))}`),
      h('div', null, `Хуже: ${formatKZT(worse[i] ?? (0 as Money))}`),
    );
    const left = (x(i) / W) * r.width;
    tip.style.left = `${Math.min(Math.max(0, left - 95), r.width - 190)}px`;
  };
  hit.addEventListener('pointermove', (e) => move(e.clientX));
  hit.addEventListener('pointerdown', (e) => move(e.clientX));
  hit.addEventListener('pointerleave', () => {
    cross.setAttribute('visibility', 'hidden');
    tip.hidden = true;
  });
  svg.append(hit);
  const legend = h('div', { class: 'legend' }, h('span', null, h('span', { class: 'sw s1' }), 'База'), h('span', null, h('span', { class: 'sw band' }), 'от «Хуже» до «Лучше»'));
  return h('figure', { class: 'viz-root' }, h('figcaption', { class: 'visually-hidden' }, title), legend, h('div', { class: 'chart-wrap' }, svg, tip));
}
