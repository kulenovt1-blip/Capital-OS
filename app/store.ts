/**
 * Состояние приложения в памяти + сохранение в IndexedDB.
 * Текущая дата берётся здесь (в UI), а в движок передаётся параметром.
 *
 * Данные никогда не затираются молча (D91): нечитаемое сохранённое состояние откладывается и блокирует запись,
 * а неудачная запись сразу видна человеку. Решения — в `persist.ts` (их проверяют тесты).
 */
import { emptyState, serializeState, type AppState, type IsoDate } from '../engine/index';
import { storage } from './storage';
import { toast } from './dom';
import { canWrite, decideLoad, ensurePreSimpleCopy, errorText, needsPreSimpleCopy, quarantineKey, type StorageHealth } from './persist';

const KEY = 'state';
let state: AppState = emptyState();
let health: StorageHealth = { mode: 'ok' };
const listeners = new Set<() => void>();

/** Сегодня в локальном часовом поясе устройства, 'YYYY-MM-DD'. Можно переопределить ?today=2026-10-28 для демонстрации. */
export function today(): IsoDate {
  const q = new URLSearchParams(location.search).get('today');
  if (q && /^\d{4}-\d{2}-\d{2}$/.test(q)) return q;
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function getState(): AppState {
  return state;
}

/** Как сейчас с хранением: всё в порядке, данные не прочитались, запись не удалась или хранилища нет. */
export function getHealth(): StorageHealth {
  return health;
}

export async function loadState(): Promise<void> {
  let raw: unknown;
  try {
    raw = await storage.get<string>(KEY);
  } catch (e) {
    health = { mode: 'no-storage', error: errorText(e) };
    console.error('IndexedDB недоступна, работаю в памяти', e);
    return;
  }
  const d = decideLoad(raw);
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
    await storage.set(KEY, serializeState(next, today()));
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
  return update(() => s, { force: true });
}

export function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function notify(): void {
  for (const l of listeners) l();
}
