/**
 * Радар трёх направлений «Положения» (T11): треугольник 0–100, SVG без библиотек.
 * Серая линия — уровень 60 (минимум каждого направления для L4), заливка — оценки. Цвета — из палитры, подписи не мельче 13 px.
 */
import { h } from './dom';

const NS = 'http://www.w3.org/2000/svg';
function s<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number>, text?: string): SVGElementTagNameMap[K] {
  const el = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
  if (text !== undefined) el.textContent = text;
  return el;
}

export interface RadarAxis {
  label: string;
  /** 0–100; null — оценить нечем (рисуется в центре). */
  score: number | null;
}

export function radar(axes: readonly [RadarAxis, RadarAxis, RadarAxis], description: string): HTMLElement {
  const W = 320, H = 250, cx = W / 2, cy = 128, R = 78;
  const ang = [-90, 30, 150].map((d) => (d * Math.PI) / 180);
  const pt = (i: number, v: number): [number, number] => [cx + Math.cos(ang[i]!) * R * (v / 100), cy + Math.sin(ang[i]!) * R * (v / 100)];
  const poly = (v: (i: number) => number) => [0, 1, 2].map((i) => pt(i, v(i)).map((n) => n.toFixed(1)).join(',')).join(' ');
  const svg = s('svg', { viewBox: `0 0 ${W} ${H}`, class: 'pos-radar', role: 'img', 'aria-label': description });
  svg.append(
    s('polygon', { points: poly(() => 100), fill: 'none', stroke: 'var(--line-strong)', 'stroke-width': 1 }),
    s('polygon', { points: poly(() => 60), fill: 'none', stroke: 'var(--threshold)', 'stroke-width': 1.6, 'stroke-dasharray': '5 4' }),
    ...[0, 1, 2].map((i) => s('line', { x1: cx, y1: cy, x2: pt(i, 100)[0], y2: pt(i, 100)[1], stroke: 'var(--line)', 'stroke-width': 1 })),
    s('polygon', { points: poly((i) => axes[i]!.score ?? 0), fill: 'var(--band)', stroke: 'var(--series-1)', 'stroke-width': 2, 'stroke-linejoin': 'round' }),
  );
  axes.forEach((a, i) => {
    const [x, y] = pt(i, 100);
    const anchor = i === 0 ? 'middle' : i === 1 ? 'start' : 'end';
    const dx = i === 0 ? 0 : i === 1 ? 8 : -8;
    const dy = i === 0 ? -22 : 16;
    svg.append(
      s('text', { x: x + dx, y: y + dy, 'text-anchor': anchor, fill: 'var(--ink)', 'font-size': 14, 'font-weight': 600 }, a.label),
      s('text', { x: x + dx, y: y + dy + 17, 'text-anchor': anchor, fill: 'var(--ink-2)', 'font-size': 14 }, a.score === null ? 'мало данных' : String(Math.round(a.score))),
    );
  });
  return h('div', { class: 'pos-radar-wrap' }, svg);
}
