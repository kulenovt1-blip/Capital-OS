/**
 * «Импорт» (D84): одна главная кнопка; сверка одной строкой, если всё сошлось, и раскрытыми расхождениями, если нет;
 * «Принять импорт» — в нижней полосе; после принятия открывается мастер. Разметки здесь нет — только ссылка.
 */
import { autoLabelCategories, formatDateRu, importMmbackup, mergeAccountSettings, parseState, reconcileAccounts, settleSetAsides, type AppState, type ImportedData, type ReconcileReport } from '../../engine/index';
import { append, h, readFileBytes, toast } from '../dom';
import { getState, replaceState, today, update } from '../store';
import { ov } from '../ctx';
import { fmt, fmtExact, info, nWord, row, rows, stickyBar, sub } from '../ui';
import { explainList } from '../explain';
import { go, refresh } from '../main';
import { isInstalled } from '../install';

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

/** Демо: выдуманный профиль «Студент» на фиксированную дату; работает только на пустом приложении (D169). */
export async function loadDemo(): Promise<void> {
  try {
    const res = await fetch('./demo.json');
    const r = parseState(await res.text());
    if (!r.ok) throw new Error(r.error);
    if (getState().imported) return;
    if (await replaceState(r.value)) location.href = `${location.pathname}?today=2026-11-04#/overview`;
  } catch (e) {
    lastError = e instanceof Error ? e.message : String(e);
    toast('Не удалось загрузить демо', 'error');
  }
}

/** Забрать файл, который service worker положил после «Поделиться → Capital OS»; забирается один раз. */
async function takeSharedFile(): Promise<File | null> {
  try {
    if (typeof caches === 'undefined') return null;
    const c = await caches.open('capital-os-share');
    const res = await c.match('shared-file');
    if (!res) return null;
    await c.delete('shared-file');
    const name = decodeURIComponent(res.headers.get('x-file-name') ?? 'MoneyManager.mmbackup');
    return new File([await res.blob()], name);
  } catch {
    return null;
  }
}

/**
 * «Поделиться → Capital OS» не появляется или не срабатывает: живая проверка и четыре шага (D187).
 * Приложение само показывает то, что может узнать: установлено ли оно как приложение и работает ли service worker.
 */
function shareHelp(): HTMLElement {
  const installed = isInstalled();
  const worker = 'serviceWorker' in navigator && !!navigator.serviceWorker.controller;
  const line = (ok: boolean, yes: string, no: string) => h('div', { class: ok ? 'ok' : 'no' }, ok ? `✓ ${yes}` : `✗ ${no}`);
  return h(
    'details',
    { class: 'fold', 'data-key': 'import:share' },
    h('summary', null, 'Через «Поделиться» из «Файлов»'),
    h(
      'div',
      { class: 'stack' },
      h('div', { class: 'share-check' }, line(installed, 'Открыто как установленное приложение', 'Открыто в браузере: «Поделиться» работает только у установленного приложения'), line(worker, 'Приложение готово принять файл', 'Приложение ещё не готово принять файл: открой его один раз при интернете')),
      h(
        'ol',
        { class: 'help-steps' },
        h('li', null, 'В Chrome: ⋮ → «Установить приложение» (не «Добавить на главный экран» — ярлык не принимает файлы).'),
        h('li', null, 'Установил давно — удали значок и установи заново: Android запоминает «Поделиться» при установке.'),
        h('li', null, 'Открой Capital OS один раз при включённом интернете, потом можно и без него.'),
        h('li', null, 'Сделай бэкап в MoneyManager. В «Файлах» нажми и удерживай файл .mmbackup → «Поделиться» → Capital OS.'),
      ),
      h('p', { class: 'muted' }, 'В самом MoneyManager такой кнопки нет — только в приложении «Файлы». Проще всего — кнопка выше: она сразу открывает выбор файла.'),
    ),
  );
}

/** Прочитать файл бэкапа и показать сверку на «Импорте». */
async function loadFile(f: File): Promise<void> {
  try {
    const data = importMmbackup(await readFileBytes(f));
    pending = { data, report: reconcileAccounts(data), fileName: f.name };
    lastError = null;
  } catch (e) {
    pending = null;
    lastError = e instanceof Error ? e.message : String(e);
  }
  if (!location.hash.startsWith('#/import')) go('#/import');
  else refresh();
}

/**
 * Выбор бэкапа в одно нажатие (D192): в MoneyManager кнопки «Поделиться» для бэкапа нет, поэтому окно выбора файла
 * открывается сразу с «Обзора» и «Ещё», без перехода на «Импорт»; после выбора — сразу сверка.
 */
export function pickBackup(): void {
  const input = h('input', { type: 'file', accept: '.mmbackup,application/octet-stream,application/zip', class: 'visually-hidden' });
  input.addEventListener('change', () => {
    const f = input.files?.[0];
    input.remove();
    if (f) void loadFile(f);
  });
  document.body.appendChild(input);
  input.click();
}

export function renderImport(_rerender: () => void): HTMLElement {
  const st = getState();
  const input = h('input', { type: 'file', accept: '.mmbackup,application/octet-stream,application/zip', id: 'mm-file', class: 'visually-hidden', 'aria-label': 'Файл бэкапа .mmbackup' });
  const load = loadFile;
  const rerender = refresh;
  input.addEventListener('change', async () => {
    const f = input.files?.[0];
    if (f) await load(f);
  });
  // файл, присланный через «Поделиться → Capital OS» (D183)
  void takeSharedFile().then((f) => {
    if (!f) return;
    toast('Файл получен через «Поделиться»');
    return load(f);
  });
  const pick = (primary: boolean, label: string) => h('label', { class: `btn ${primary ? 'primary big' : ''} wide file-btn` }, label, input);

  const root = h('div', { class: 'screen' });
  if (pending) {
    const p = pending;
    const ok = p.report.ok;
    const accept = async () => {
      const data = p.data;
      pending = null;
      let moved = 0;
      let labeled = 0;
      const known = new Set(getState().settings.accounts.map((a) => a.accountId));
      const hadData = !!getState().imported;
      await update((s) => {
        // новые категории размечаются сами по названию; «Отложил» — найти переводы на копилки (D96)
        const auto = autoLabelCategories(s.settings.classification, data, s.settings.classes);
        labeled = auto.added;
        const next: AppState = { ...s, imported: data, importedAt: today(), settings: { ...s.settings, classification: auto.settings, classes: auto.classes, accounts: mergeAccountSettings(s.settings.accounts, data.accounts) } };
        const settled = settleSetAsides(next, today());
        moved = settled.moved;
        return settled.state;
      });
      // новые счета при повторном импорте: сказать, кем приложение их посчитало (D103)
      const o = ov();
      const fresh = hadData ? o.capital.accounts.filter((p) => !known.has(p.accountId) && !p.excluded && p.source === 'moneymanager') : [];
      const freshText = fresh.length ? `новые счета: ${fresh.map((p) => `«${p.title}» — ${o.spend.kinds[p.accountId] === 'savings' ? 'копилка' : 'для трат'}`).join(', ')} (проверь в «Счетах»)` : '';
      const extra = [labeled ? `новых категорий разложено: ${labeled}` : '', moved ? `переводы на копилку найдены: ${fmt(moved as never)}` : '', freshText].filter(Boolean).join(' · ');
      toast(`${ok ? 'Импорт принят' : 'Импорт принят с расхождением — цифры помечены красным'}${extra ? ` · ${extra}` : ''}`);
      go('#/overview'); // сначала число, потом вопросы (С1 аудита UX): мастер — карточкой на «Обзоре»
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
      h('button', { class: 'btn link wide', type: 'button', onclick: loadDemo }, 'Посмотреть на демо-данных'),
      lastError ? h('div', { class: 'error-box', role: 'alert' }, `Не удалось прочитать файл: ${lastError}`) : null,
      shareHelp(),
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
    data.warnings.length
      ? h('details', { class: 'fold', 'data-key': 'import:warnings' }, h('summary', null, `Замечания импорта (${data.warnings.length})`), h('ul', { class: 'explain-list' }, data.warnings.map((w) => h('li', null, w.text))))
      : null,
    lastError ? h('div', { class: 'error-box', role: 'alert' }, `Не удалось прочитать файл: ${lastError}`) : null,
    rows(
      unclassified ? row({ title: `Разметить ${nWord(unclassified, 'категорию', 'категории', 'категорий')}`, href: '#/markup' }) : row({ title: 'Разметка', sub: 'всё размечено ✓', href: '#/markup' }),
      row({ title: 'Счета «не учитывать в балансе»', href: '#/setup/accounts' }),
    ),
    pick(true, 'Загрузить новый бэкап'),
    h('p', { class: 'one-line' }, 'Новый бэкап заменит данные; настройки, цели и рассрочки сохранятся.'),
    h('details', { class: 'fold', 'data-key': 'import:explain' }, h('summary', null, 'Сверка подробно'), explainList(rep.explanation)),
    shareHelp(),
  ]);
  return root;
}
