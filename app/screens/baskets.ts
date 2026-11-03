/**
 * «Раскладка трат» (D96): категории расходов по 4 корзинам — повседневное, регулярное, разовое, долги и рассрочки.
 * Корзина = поведение типа в расчётах; переложить категорию — одно нажатие. Тонкая разметка типами — «Разметка».
 */
import { BASKET_HINTS, BASKET_LABELS, basketClass, basketOfClass, classGroup, classRegistry, setCategoryClass, type Basket } from '../../engine/index';
import { h } from '../dom';
import { act, getState } from '../store';
import { catName, categoryRows, type CatRow } from '../blocks';
import { fmt, row, rows, sub } from '../ui';
import { defineSheet, closeSheet, sheetHref } from '../main';

const ORDER: Basket[] = ['everyday', 'regular', 'oneoff', 'debts'];

function rowsByBasket(): Map<Basket | 'other', CatRow[]> {
  const st = getState();
  const reg = classRegistry(st.settings.classes);
  const out = new Map<Basket | 'other', CatRow[]>();
  for (const r of categoryRows(st)) {
    if (r.kind !== 'expense') continue;
    // долги, переводы на сбережения, поправки — не траты, в корзины не входят
    if (r.current !== 'mixed' && r.current !== 'UNCLASSIFIED' && classGroup(r.current) !== 'expense') continue;
    const b = r.current === 'mixed' || r.current === 'UNCLASSIFIED' ? null : basketOfClass(r.current, reg);
    const key = b ?? 'other';
    out.set(key, [...(out.get(key) ?? []), r]);
  }
  return out;
}

defineSheet('basket', (catId) => {
  const st = getState();
  const r = categoryRows(st).find((x) => x.cat.id === catId && x.kind === 'expense');
  if (!r) return null;
  const reg = classRegistry(st.settings.classes);
  const cur = r.current === 'mixed' || r.current === 'UNCLASSIFIED' ? null : basketOfClass(r.current, reg);
  const put = (b: Basket) =>
    act((s) => {
      const { cls, classes } = basketClass(b, s.settings.classes);
      return { ...s, settings: { ...s.settings, classes, classification: setCategoryClass(s.settings.classification, r.cat, cls, 'expense') } };
    }, `«${catName(r.cat)}» → ${BASKET_LABELS[b]}`).then(closeSheet);
  return {
    title: catName(r.cat),
    body: h(
      'div',
      { class: 'stack' },
      h('p', { class: 'muted' }, `${r.count} операций на ${fmt(r.total as never)}. Куда относится?`),
      rows(ORDER.map((b) => row({ title: BASKET_LABELS[b], sub: BASKET_HINTS[b], value: b === cur ? '✓' : undefined, cls: b === cur ? 'on' : '', onClick: () => void put(b) }))),
      h('a', { class: 'btn link', href: '#/markup' }, 'Тонкая разметка типами ›'),
    ),
  };
});

export function renderBaskets(_rerender: () => void): HTMLElement {
  const st = getState();
  const root = h('div', { class: 'screen' });
  if (!st.imported) {
    root.append(h('div', { class: 'card stack' }, h('strong', null, 'Сначала загрузи бэкап'), h('a', { class: 'btn primary wide', href: '#/import' }, 'Загрузить бэкап')));
    return root;
  }
  const by = rowsByBasket();
  const auto = new Set(st.settings.classification.rules.filter((x) => x.auto && x.categoryId).map((x) => x.categoryId!));
  root.append(h('p', { class: 'one-line' }, 'Приложение разложило категории само — по названию. Нажми на категорию, чтобы переложить.'));
  const line = (r: CatRow) => row({ title: catName(r.cat), sub: `${r.count} опер. · ${fmt(r.total as never)}${auto.has(r.cat.id) ? ' · разложено само' : ''}`, href: sheetHref('basket', r.cat.id) });
  for (const b of ORDER) {
    const list = by.get(b) ?? [];
    root.append(sub(BASKET_LABELS[b]), h('p', { class: 'muted' }, BASKET_HINTS[b]), list.length ? rows(list.map(line)) : h('p', { class: 'muted' }, 'пусто'));
  }
  const other = by.get('other') ?? [];
  if (other.length) root.append(sub('Не разложено'), rows(other.map(line)));
  return root;
}
