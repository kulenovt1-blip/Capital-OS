/**
 * Состояние приложения в памяти + сохранение в IndexedDB.
 * Текущая дата берётся здесь (в UI), а в движок передаётся параметром.
 *
 * Данные никогда не затираются молча (D91): нечитаемое сохранённое состояние откладывается и блокирует запись,
 * а неудачная запись сразу видна человеку. Решения — в `persist.ts` (их проверяют тесты).
 */
import { emptyState, parseState, serializeState, type AppState, type IsoDate } from '../engine/index';
import { storage } from './storage';
import { toast } from './dom';
import { LATEST_RELEASE } from './whatsnew-data';
import { PERSONA_DATE, personaById, type PersonaMeta } from './personas';
import { canWrite, decideLoad, ensurePreSimpleCopy, errorText, needsPreSimpleCopy, quarantineKey, type StorageHealth } from './persist';

const KEY = 'state';
let state: AppState = emptyState();
let health: StorageHealth = { mode: 'ok' };
const listeners = new Set<() => void>();

/**
 * Режим «На примере»: выдуманный персонаж живёт в отдельном ключе хранилища, собственные данные человека не читаются и не пишутся.
 * Выбор запоминается флагом в localStorage, чтобы пример пережил перезагрузку; выход возвращает собственные данные как были (D176/D91).
 */
const DEMO_FLAG = 'capital-os-demo';
const DEMO_KEY = 'demo:state';
let demo: PersonaMeta | null = null;

export function getDemo(): PersonaMeta | null {
  return demo;
}

const readDemoFlag = (): string | null => {
  try {
    return localStorage.getItem(DEMO_FLAG);
  } catch {
    return null;
  }
};

/** Открыть пример: запоминаем выбор и перезагружаем приложение на профиле персонажа. */
export function enterDemo(id: string): void {
  if (!personaById(id)) return;
  try {
    localStorage.setItem(DEMO_FLAG, id);
    void storage.remove(DEMO_KEY).catch(() => undefined);
  } catch {
    toast('Браузер не даёт открыть пример', 'error');
    return;
  }
  // небольшая задержка: удаление прошлого примера должно успеть до перезагрузки
  setTimeout(() => (location.href = `${location.pathname}#/position`), 60);
  setTimeout(() => location.reload(), 120);
}

/** Выйти из примера. `toImport` — сразу открыть «Импорт» (человек пришёл загрузить свои данные). */
export function exitDemo(toImport = false): void {
  try {
    localStorage.removeItem(DEMO_FLAG);
  } catch {
    /* флаг не снимается — следующая загрузка снова откроет пример; человек увидит плашку и нажмёт ещё раз */
  }
  void storage.remove(DEMO_KEY).catch(() => undefined);
  setTimeout(() => {
    location.href = `${location.pathname}#/${toImport ? 'import' : 'overview'}`;
    location.reload();
  }, 80);
}

async function loadDemoState(meta: PersonaMeta): Promise<boolean> {
  try {
    let loaded: AppState | null = null;
    const saved = await storage.get<string>(DEMO_KEY);
    if (typeof saved === 'string') {
      const d = decideLoad(saved);
      if (d.kind === 'ok') loaded = d.state;
    }
    if (!loaded) {
      const res = await fetch(`./personas/${meta.id}.json`);
      const r = parseState(await res.text());
      if (!r.ok) throw new Error(r.error);
      loaded = r.value;
    }
    // режим экрана берём у человека: если у него простой — пример тоже простой
    let uiMode: 'simple' | 'full' = 'simple';
    try {
      const mine = decideLoad(await storage.get<string>(KEY));
      if (mine.kind === 'ok' && mine.state.settings.uiMode) uiMode = mine.state.settings.uiMode;
    } catch {
      /* своих данных не видно — простой режим, как у нового человека */
    }
    state = { ...loaded, settings: { ...loaded.settings, uiMode, whatsNewSeen: LATEST_RELEASE.id } };
    demo = meta;
    return true;
  } catch (e) {
    console.error('Не удалось открыть пример', e);
    return false;
  }
}

/** Сегодня в локальном часовом поясе устройства, 'YYYY-MM-DD'. Можно переопределить ?today=2026-10-28 для демонстрации. */
export function today(): IsoDate {
  if (demo) return PERSONA_DATE;
  const q = new URLSearchParams(location.search).get('today');
  if (q && /^\d{4}-\d{2}-\d{2}$/.test(q)) return q;
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/**
 * Показ «как это выглядит в другом режиме» во время подсказки (D191): режим подменяется только для экрана, в хранилище не пишется.
 * Производное состояние кэшируется, чтобы расчёты, привязанные к самому объекту состояния, не пересчитывались на каждый вызов.
 */
let preview: 'simple' | 'full' | null = null;
let previewBase: AppState | null = null;
let previewState: AppState | null = null;

export function getState(): AppState {
  if (!preview) return state;
  if (previewBase !== state || !previewState) {
    previewBase = state;
    previewState = { ...state, settings: { ...state.settings, uiMode: preview } };
  }
  return previewState;
}

export function setPreviewMode(m: 'simple' | 'full' | null): void {
  if (preview === m) return;
  preview = m;
  previewState = null;
  notify();
}

/** Как сейчас с хранением: всё в порядке, данные не прочитались, запись не удалась или хранилища нет. */
export function getHealth(): StorageHealth {
  return health;
}

export async function loadState(): Promise<void> {
  const meta = personaById(readDemoFlag());
  if (meta) {
    if (await loadDemoState(meta)) return;
    // пример не открылся — снимаем флаг и работаем с собственными данными, ничего не теряя
    try {
      localStorage.removeItem(DEMO_FLAG);
    } catch {
      /* ничего */
    }
    toast('Пример не открылся — вернул твои данные', 'error');
  }
  let raw: unknown;
  try {
    raw = await storage.get<string>(KEY);
  } catch (e) {
    health = { mode: 'no-storage', error: errorText(e) };
    console.error('IndexedDB недоступна, работаю в памяти', e);
    return;
  }
  const d = decideLoad(raw);
  // первый запуск: новому человеку — простой режим; у тех, у кого данные уже есть, поля нет, и всё остаётся как было (D185)
  if (d.kind === 'empty') state = { ...state, settings: { ...state.settings, uiMode: 'simple' } };
  if (d.kind === 'ok') {
    state = d.state;
    // перенос на новую модель экранов (D96, D103): сначала копия исходника с проверкой; не вышло — только чтение
    if (needsPreSimpleCopy(raw)) {
      const c = await ensurePreSimpleCopy(storage, raw as string);
      if (!c.ok) {
        health = { mode: 'copy-failed', error: c.error, raw: raw as string };
        console.error('Копия перед переносом не сделана — запись заблокирована', c.error);
      }
    }
  }
  if (d.kind !== 'unreadable') return;
  // исходник откладываем под отдельный ключ: даже если человек потом начнёт заново, копия останется в браузере
  let savedAs: string | null = quarantineKey(d.raw);
  try {
    await storage.set(savedAs, d.raw);
  } catch (e) {
    savedAs = null;
    console.error('Не удалось отложить нечитаемые данные', e);
  }
  health = { mode: 'unreadable', error: d.error, raw: d.raw, savedAs };
  console.error('Сохранённое состояние не прочитано:', d.error);
}

/**
 * Изменить состояние: функция получает копию и возвращает новое. Сохраняется сразу.
 * Возвращает true, если изменение сохранено. Если запись не удалась — изменение остаётся в памяти
 * (его можно скачать бэкапом), а человек видит красную плашку.
 * `force` — для восстановления из бэкапа и «начать заново»: разрешено даже при нечитаемых данных.
 */
export async function update(fn: (s: AppState) => AppState, opts: { force?: boolean } = {}): Promise<boolean> {
  if (!canWrite(health, !!opts.force)) {
    toast(health.mode === 'copy-failed' ? 'Пока копия данных не сделана, изменения не сохраняются — нажми «Повторить» в красной плашке' : 'Сначала реши, что делать с сохранёнными данными', 'error');
    return false;
  }
  const next = fn(structuredClone(state));
  state = next;
  try {
    await storage.set(demo ? DEMO_KEY : KEY, serializeState(next, today()));
    if (health.mode !== 'ok' && health.mode !== 'no-storage') health = { mode: 'ok' };
    notify();
    return true;
  } catch (e) {
    const error = errorText(e);
    // хранилища нет совсем — об этом уже говорит плашка, повторять сообщение на каждое действие не нужно
    if (health.mode !== 'no-storage') health = { mode: 'write-failed', error };
    console.error('Не удалось сохранить', e);
    notify();
    toast(`Не сохранено: ${error}. Скачай бэкап, чтобы не потерять изменения`, 'error');
    return false;
  }
}

/**
 * Обратимое действие (D76): изменить и показать «Сделано · Отменить» на 5 секунд.
 * Сообщение об успехе — только если изменение действительно сохранено (D91).
 * Отмена возвращает состояние целиком к моменту до действия.
 */
export async function act(fn: (s: AppState) => AppState, message: string, opts: { force?: boolean } = {}): Promise<void> {
  const before = state;
  if (!(await update(fn, opts))) return;
  toast(message, {
    undo: async () => {
      if (await update(() => before)) toast('Отменено');
    },
  });
}

/** Повторить копию перед переносом (D103). true — копия сделана, запись снова разрешена. */
export async function retryPreSimpleCopy(): Promise<boolean> {
  if (health.mode !== 'copy-failed') return true;
  const c = await ensurePreSimpleCopy(storage, health.raw);
  health = c.ok ? { mode: 'ok' } : { ...health, error: c.error };
  notify();
  return c.ok;
}

/** Заменить состояние целиком: восстановление из бэкапа, «стереть всё», «начать заново». */
export async function replaceState(s: AppState): Promise<boolean> {
  if (demo) {
    toast('Сначала выйди из примера: он не принимает свои данные', 'error');
    return false;
  }
  return update(() => s, { force: true });
}

export function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function notify(): void {
  for (const l of listeners) l();
}
