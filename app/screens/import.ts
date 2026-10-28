/** Экран «Импорт»: загрузка .mmbackup, сверка по счетам, разметка неклассифицированных операций. */
import {
  accountsNeedingReview, classifyAll, classRegistry, importMmbackup, mergeAccountSettings, reconcileAccounts, setCategoryClass, formatDateRu,
  type ImportedData, type ReconcileReport,
} from '../../engine/index';
import { h, readFileBytes, section, table, toast } from '../dom';
import { getState, today, update } from '../store';
import { anchor, classSelect, explainBlock, fmt, info, moneySpan } from '../ui';

let pending: { data: ImportedData; report: ReconcileReport; fileName: string } | null = null;
let lastError: string | null = null;

function reconcileTable(rep: ReconcileReport): HTMLElement {
  return table(
    ['Счёт', 'По операциям', 'В MoneyManager', 'Разница', ''],
    rep.accounts.map((a) => [
      a.title,
      moneySpan(a.computed),
      a.reported === null ? '—' : moneySpan(a.reported),
      a.diff === 0 ? '0' : moneySpan(a.diff, { sign: true }),
      h('span', { class: `badge ${a.status === 'ok' ? 'ok' : 'bad'}` }, a.status === 'ok' ? 'сходится' : a.status === 'mismatch' ? 'расхождение' : 'нет эталона'),
    ]),
    'num-cols',
  );
}

/** Вопрос о счетах, помеченных в MoneyManager «не учитывать в балансе» (D58). */
function reviewSection(accounts: { id: string; title: string }[]): HTMLElement {
  const st = getState();
  const goals = st.goals.filter((g) => g.status !== 'cancelled' && g.status !== 'done');
  const decide = (id: string, excluded: boolean, boundGoalId?: string) =>
    update((s) => {
      const rest = s.settings.accounts.filter((x) => x.accountId !== id);
      const prev = s.settings.accounts.find((x) => x.accountId === id);
      const next = { accountId: id, liquidity: prev?.liquidity ?? { kind: 'instant' as const }, excluded, reviewed: true, ...(boundGoalId ? { boundGoalId } : {}) };
      return { ...s, settings: { ...s.settings, accounts: [...rest, next].sort((x, y) => (x.accountId < y.accountId ? -1 : 1)) } };
    }).then(() => toast('Сохранено'));
  return section(
    h('span', null, 'Счета «не учитывать в балансе» — что это?', info('ignoreInBalance')),
    h('p', { class: 'muted' }, 'В MoneyManager этот флаг ставят и на технические счета, и на заначки, которые не хочется видеть «на руках». Это разные вещи: заначка — твои деньги и входит в капитал. Пока не ответишь, счёт исключён.'),
    h(
      'ul',
      { class: 'plain' },
      accounts.map((a) => {
        const sel = h('select', null, h('option', { value: '' }, 'не привязывать к цели'), goals.map((g) => h('option', { value: g.id }, `весь остаток — за целью «${g.title}»`)));
        return h(
          'li',
          { class: 'review' },
          h('strong', null, a.title),
          h(
            'div',
            { class: 'row' },
            h('button', { class: 'btn', type: 'button', onclick: () => decide(a.id, true) }, 'Технический — исключить'),
            h('button', { class: 'btn primary', type: 'button', onclick: () => decide(a.id, false, sel.value || undefined) }, 'Отложенные деньги — учитывать'),
            goals.length ? sel : h('small', { class: 'muted' }, 'чтобы деньги не считались свободными, создай цель (например, «Резерв») и привяжи счёт в «Настройках»'),
          ),
        );
      }),
    ),
  );
}

export function renderImport(rerender: () => void): HTMLElement {
  const st = getState();
  const root = h('div', { class: 'screen' });

  const input = h('input', { type: 'file', accept: '.mmbackup,application/octet-stream,application/zip', id: 'mm-file' });
  input.addEventListener('change', async () => {
    const f = input.files?.[0];
    if (!f) return;
    try {
      const data = importMmbackup(await readFileBytes(f));
      pending = { data, report: reconcileAccounts(data), fileName: f.name };
      lastError = null;
    } catch (e) {
      pending = null;
      lastError = e instanceof Error ? e.message : String(e);
    }
    rerender();
  });

  root.append(
    section(
      'Загрузить бэкап MoneyManager',
      h('p', { class: 'muted' }, 'Файл .mmbackup читается прямо в браузере и никуда не отправляется. Повторный импорт заменяет прошлый; настройки, обязательства и цели сохраняются.'),
      h('label', { class: 'btn primary file-btn' }, 'Выбрать файл .mmbackup', input),
      lastError ? h('div', { class: 'notice error' }, `Не удалось прочитать файл: ${lastError}`) : null,
    ),
  );

  if (pending) {
    const p = pending;
    const ok = p.report.ok;
    root.append(
      section(
        `Проверка файла «${p.fileName}»`,
        h('div', { class: `notice ${ok ? 'info' : 'error'}` }, p.report.explanation[0]!.text),
        reconcileTable(p.report),
        h('p', { class: 'muted' }, `Период: ${p.data.meta.firstDate ? formatDateRu(p.data.meta.firstDate) : '—'} — ${p.data.meta.lastDate ? formatDateRu(p.data.meta.lastDate) : '—'}, операций: ${p.data.operations.length}`),
        p.data.warnings.length ? h('details', { class: 'explain', open: true }, h('summary', null, `Предупреждения импорта (${p.data.warnings.length})`), h('ul', null, p.data.warnings.map((w) => h('li', { class: 'warn' }, w.text)))) : null,
        h(
          'div',
          { class: 'row' },
          h(
            'button',
            {
              class: `btn ${ok ? 'primary' : 'danger'}`,
              type: 'button',
              onclick: async () => {
                const data = p.data;
                pending = null;
                await update((s) => ({ ...s, imported: data, importedAt: today(), settings: { ...s.settings, accounts: mergeAccountSettings(s.settings.accounts, data.accounts) } }));
                toast(ok ? 'Импорт принят' : 'Импорт принят с расхождением — отчёты помечены');
              },
            },
            ok ? 'Принять импорт' : 'Принять, несмотря на расхождение',
          ),
          h('button', { class: 'btn', type: 'button', onclick: () => ((pending = null), rerender()) }, 'Отмена'),
        ),
      ),
    );
  }

  if (st.imported) {
    const review = accountsNeedingReview(st.settings.accounts, st.imported.accounts);
    if (review.length) root.append(anchor(reviewSection(review.map((a) => ({ id: a.id, title: a.title }))), 'review'));
  }

  if (st.imported) {
    const data = st.imported;
    const rep = reconcileAccounts(data);
    const cls = classifyAll(data, st.settings.classification);
    root.append(
      section(
        h('span', null, 'Текущие данные', info('reconcile')),
        h('p', null, `Импортировано ${st.importedAt ? formatDateRu(st.importedAt) : '—'}; период ${data.meta.firstDate ? formatDateRu(data.meta.firstDate) : '—'} — ${data.meta.lastDate ? formatDateRu(data.meta.lastDate) : '—'}; операций ${data.operations.length}; счетов ${data.accounts.filter((a) => !a.removed).length}.`),
        h('div', { class: `notice ${rep.ok ? 'info' : 'error'}` }, rep.explanation[0]!.text),
        reconcileTable(rep),
      ),
    );

    const groups = cls.unclassified;
    root.append(
      section(
        h('span', null, groups.length ? `Неразмеченные категории (${groups.length})` : 'Разметка категорий', info('unclassified')),
        groups.length
          ? h('p', { class: 'muted' }, 'Пока они есть, отчёты помечены «неполные». Выбор класса сохраняется как правило «категория → класс» и применяется ко всем операциям этой категории.')
          : h('p', null, 'Все операции размечены.'),
        groups.length
          ? table(
              ['Категория', 'Тип', 'Операций', 'Сумма', 'Класс'],
              groups.map((g) => {
                const category = data.categories.find((c) => c.id === g.categoryId);
                return [
                  h('span', null, g.label, g.reason === 'conflict' ? h('small', { class: 'warn-text' }, ' (конфликт правила)') : null),
                  g.opKind === 'income' ? 'доход' : 'расход',
                  String(g.count),
                  fmt(g.total),
                  category
                    ? classSelect(g.opKind, '', async (c) => {
                        await update((s) => ({ ...s, settings: { ...s.settings, classification: setCategoryClass(s.settings.classification, category, c, g.opKind) } }));
                        toast(`«${g.label}» → ${c}`);
                      }, classRegistry(st.settings.classes))
                    : h('small', { class: 'muted' }, 'категория удалена в MoneyManager'),
                ];
              }),
            )
          : null,
        h(
          'details',
          { class: 'explain' },
          h('summary', null, 'Итоги по классам'),
          table(
            ['Класс', 'Операций', 'Сумма'],
            Object.entries(cls.byClass)
              .filter(([, v]) => v.count > 0)
              .map(([k, v]) => [k, String(v.count), fmt(v.total)]),
          ),
        ),
      ),
    );
    const ex = explainBlock(rep.explanation, 'Сверка подробно');
    if (ex) root.append(ex);
  }
  return root;
}
