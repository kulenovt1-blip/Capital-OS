/**
 * «Импорт» (D84): одна главная кнопка; сверка одной строкой, если всё сошлось, и раскрытыми расхождениями, если нет;
 * «Принять импорт» — в нижней полосе; после принятия открывается мастер. Разметки здесь нет — только ссылка.
 */
import { formatDateRu, importMmbackup, mergeAccountSettings, reconcileAccounts, type ImportedData, type ReconcileReport } from '../../engine/index';
import { append, h, readFileBytes, toast } from '../dom';
import { getState, today, update } from '../store';
import { ov } from '../ctx';
import { fmtExact, info, nWord, row, rows, stickyBar, sub } from '../ui';
import { explainList } from '../explain';
import { go } from '../main';

let pending: { data: ImportedData; report: ReconcileReport; fileName: string } | null = null;
let lastError: string | null = null;

function reconcileBlock(rep: ReconcileReport): HTMLElement {
  const bad = rep.accounts.filter((a) => a.status !== 'ok');
  const n = rep.accounts.length;
  const detail = h(
    'details',
    { class: 'fold', 'data-key': 'import:accounts' },
    h('summary', null, 'Подробно по счетам'),
    rows(rep.accounts.map((a) => row({ title: a.title, sub: `по операциям ${fmtExact(a.computed)} · в MoneyManager ${a.reported === null ? 'нет данных' : fmtExact(a.reported)}`, value: a.status === 'ok' ? '✓' : a.status === 'mismatch' ? fmtExact(a.diff, true) : 'без эталона', cls: a.status === 'ok' ? '' : 'bad', mark: a.status !== 'ok' }))),
  );
  if (!bad.length) return h('div', { class: 'stack' }, h('div', { class: 'okline' }, `✓ Все ${nWord(n, 'счёт сходится', 'счёта сходятся', 'счетов сходятся')} до тиына`), detail);
  return h(
    'div',
    { class: 'stack' },
    h('div', { class: 'badline' }, h('strong', null, `Сверка не сошлась по ${nWord(bad.length, 'счёту', 'счетам', 'счетам')}`), h('p', { style: 'margin:4px 0 0' }, 'Сумма операций не совпала с балансом в MoneyManager — цифрам по этим счетам нельзя верить.')),
    rows(bad.map((a) => row({ title: a.title, sub: a.status === 'no_reference' ? 'в MoneyManager нет баланса для сверки' : `по операциям ${fmtExact(a.computed)} · в MoneyManager ${fmtExact(a.reported ?? (0 as never))}`, value: a.status === 'mismatch' ? fmtExact(a.diff, true) : '—', cls: 'bad', mark: true }))),
    detail,
  );
}

function period(d: ImportedData): string {
  return `${d.meta.firstDate ? formatDateRu(d.meta.firstDate) : '—'} — ${d.meta.lastDate ? formatDateRu(d.meta.lastDate) : '—'}`;
}

export function renderImport(rerender: () => void): HTMLElement {
  const st = getState();
  const input = h('input', { type: 'file', accept: '.mmbackup,application/octet-stream,application/zip', id: 'mm-file', class: 'visually-hidden', 'aria-label': 'Файл бэкапа .mmbackup' });
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
  const pick = (primary: boolean, label: string) => h('label', { class: `btn ${primary ? 'primary big' : ''} wide file-btn` }, label, input);

  const root = h('div', { class: 'screen' });
  if (pending) {
    const p = pending;
    const ok = p.report.ok;
    const accept = async () => {
      const data = p.data;
      pending = null;
      await update((s) => ({ ...s, imported: data, importedAt: today(), settings: { ...s.settings, accounts: mergeAccountSettings(s.settings.accounts, data.accounts) } }));
      toast(ok ? 'Импорт принят' : 'Импорт принят с расхождением — цифры помечены красным');
      go('#/setup');
    };
    append(root, [
      sub(`Файл «${p.fileName}»`),
      h('p', { class: 'one-line' }, `${period(p.data)} · ${nWord(p.data.operations.length, 'операция', 'операции', 'операций')}`),
      reconcileBlock(p.report),
      p.data.warnings.length ? h('details', { class: 'fold' }, h('summary', null, `Предупреждения импорта (${p.data.warnings.length})`), h('ul', { class: 'explain-list' }, p.data.warnings.map((w) => h('li', { class: 'warn' }, w.text)))) : null,
      pick(false, 'Выбрать другой файл'),
      stickyBar(
        h('button', { class: 'btn link', type: 'button', onclick: () => ((pending = null), rerender()) }, 'Отмена'),
        h('button', { class: `btn ${ok ? 'primary' : 'danger'}`, type: 'button', onclick: accept }, ok ? `Принять импорт · ${p.data.operations.length}` : 'Принять, несмотря на расхождение'),
      ),
    ]);
    return root;
  }

  if (!st.imported) {
    append(root, [
      h('div', { class: 'card stack' }, h('strong', null, 'Загрузи бэкап MoneyManager'), h('p', { class: 'muted', style: 'margin:0' }, 'Файл .mmbackup читается на этом устройстве и никуда не отправляется.')),
      pick(true, 'Выбрать файл .mmbackup'),
      lastError ? h('div', { class: 'error-box', role: 'alert' }, `Не удалось прочитать файл: ${lastError}`) : null,
    ]);
    return root;
  }

  const data = st.imported;
  const rep = reconcileAccounts(data);
  const o = ov();
  const unclassified = o.classification?.unclassified.length ?? 0;
  append(root, [
    sub(h('span', null, 'Текущие данные', info('reconcile'))),
    h('p', { class: 'one-line' }, `Импорт ${st.importedAt ? formatDateRu(st.importedAt) : '—'} · ${period(data)} · ${nWord(data.operations.length, 'операция', 'операции', 'операций')}`),
    reconcileBlock(rep),
    lastError ? h('div', { class: 'error-box', role: 'alert' }, `Не удалось прочитать файл: ${lastError}`) : null,
    rows(
      unclassified ? row({ title: `Разметить ${nWord(unclassified, 'категорию', 'категории', 'категорий')}`, href: '#/markup' }) : row({ title: 'Разметка', sub: 'всё размечено ✓', href: '#/markup' }),
      row({ title: 'Счета «не учитывать в балансе»', href: '#/setup/accounts' }),
    ),
    pick(true, 'Загрузить новый бэкап'),
    h('p', { class: 'one-line' }, 'Новый бэкап заменит данные; настройки, цели и рассрочки сохранятся.'),
    h('details', { class: 'fold', 'data-key': 'import:explain' }, h('summary', null, 'Сверка подробно'), explainList(rep.explanation)),
  ]);
  return root;
}
