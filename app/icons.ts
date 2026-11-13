/** Значки интерфейса (D190, D193): один набор линий 24×24 на всё приложение — окна, плитки, подсказки. */
export const ICONS = {
  spark: 'M12 3l2.2 6.8L21 12l-6.8 2.2L12 21l-2.2-6.8L3 12l6.8-2.2zM19 3v4M17 5h4',
  wallet: 'M3 7h15a3 3 0 0 1 3 3v7a3 3 0 0 1-3 3H6a3 3 0 0 1-3-3zM3 7l12-4v4M17 13.5h.01',
  arrive: 'M12 3v10M8 9l4 4 4-4M4 16c0 2.2 3.6 4 8 4s8-1.8 8-4',
  target: 'M12 3a9 9 0 1 0 9 9M12 7a5 5 0 1 0 5 5M12 11a1 1 0 1 0 1 1M14 10l6-6M17 4h3v3',
  chart: 'M4 19h16M5 15l4-5 4 3 6-8',
  profile: 'M12 4 20 18H4zM12 10l4 6H8z',
  calendar: 'M4 6h16v14H4zM4 10h16M8 3v4M16 3v4M8 14h3',
  layers: 'M12 3 21 8l-9 5-9-5zM3 13l9 5 9-5',
  share: 'M18 2a3 3 0 1 0 0 6 3 3 0 0 0 0-6zM6 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6zM18 16a3 3 0 1 0 0 6 3 3 0 0 0 0-6zM8.6 13.5l6.8 4M15.4 6.5l-6.8 4',
  shield: 'M12 3 4 6v6c0 5 3.5 8 8 9 4.5-1 8-4 8-9V6zM9 12l2 2 4-4',
  upload: 'M12 16V4M7 9l5-5 5 5M4 20h16',
  save: 'M5 4h11l3 3v13H5zM8 4v5h7V4M8 20v-6h8v6',
  cut: 'M6 3a3 3 0 1 0 0 6 3 3 0 0 0 0-6zM6 15a3 3 0 1 0 0 6 3 3 0 0 0 0-6zM8.5 7.5 20 18M8.5 16.5 20 6',
  scale: 'M12 4v16M5 8h14M5 8l-3 6a3 3 0 0 0 6 0zM19 8l-3 6a3 3 0 0 0 6 0zM8 20h8',
  drain: 'M12 3c3 4 6 7 6 11a6 6 0 0 1-12 0c0-4 3-7 6-11z',
  laptop: 'M5 6h14v10H5zM3 19h18',
  plane: 'M3 13l18-7-7 18-2-8z',
  home: 'M4 11.5 12 5l8 6.5V19a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1z',
  plus: 'M12 5v14M5 12h14',
  play: 'M8 5v14l11-7z',
  book: 'M4 5a2 2 0 0 1 2-2h13v16H6a2 2 0 0 0-2 2zM8 7h7',
  job: 'M4 8h16v11H4zM9 8V5h6v3M4 13h16',
  study: 'M2 9l10-5 10 5-10 5zM6 11v5c3 2 9 2 12 0v-5',
  cart: 'M3 4h2l2.4 11h11L21 7H6.2M9 20h.01M18 20h.01',
  card: 'M3 6h18v12H3zM3 10h18M7 15h4',
  down: 'M4 7l6 6 4-4 6 6M20 11v4h-4',
  up: 'M4 17l6-6 4 4 6-6M20 13V9h-4',
  check: 'M5 12l5 5 9-10',
  gauge: 'M4 16a8 8 0 1 1 16 0M12 16l4-5',
} as const;

export type Icon = keyof typeof ICONS;

export function iconSvg(key: Icon, size?: number): SVGSVGElement {
  const NS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  if (size) (svg.setAttribute('width', String(size)), svg.setAttribute('height', String(size)));
  const p = document.createElementNS(NS, 'path');
  p.setAttribute('d', ICONS[key]);
  for (const [k, v] of Object.entries({ fill: 'none', stroke: 'currentColor', 'stroke-width': '1.8', 'stroke-linecap': 'round', 'stroke-linejoin': 'round' })) p.setAttribute(k, v);
  svg.appendChild(p);
  return svg;
}
