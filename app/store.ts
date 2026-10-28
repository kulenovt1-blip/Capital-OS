/**
 * Состояние приложения в памяти + сохранение в IndexedDB.
 * Текущая дата берётся здесь (в UI), а в движок передаётся параметром.
 */
import { emptyState, parseState, serializeState, type AppState, type IsoDate } from '../engine/index';
import { storage } from './storage';
import { toast } from './dom';

const KEY = 'state';
let state: AppState = emptyState();
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

export async function loadState(): Promise<void> {
  try {
    const raw = await storage.get<string>(KEY);
    if (raw) {
      const r = parseState(raw);
      if (r.ok) state = r.value;
      else console.error('Сохранённое состояние не прочитано:', r.error);
    }
  } catch (e) {
    console.error('IndexedDB недоступна, работаю в памяти', e);
  }
}

/** Изменить состояние: функция получает копию и возвращает новое. Сохраняется сразу. */
export async function update(fn: (s: AppState) => AppState): Promise<void> {
  state = fn(structuredClone(state));
  notify();
  try {
    await storage.set(KEY, serializeState(state, today()));
  } catch (e) {
    console.error('Не удалось сохранить', e);
  }
}

/**
 * Обратимое действие (D76): изменить и показать «Сделано · Отменить» на 5 секунд.
 * Отмена возвращает состояние целиком к моменту до действия.
 */
export async function act(fn: (s: AppState) => AppState, message: string): Promise<void> {
  const before = state;
  await update(fn);
  toast(message, { undo: () => update(() => before).then(() => toast('Отменено')) });
}

export async function replaceState(s: AppState): Promise<void> {
  await update(() => s);
}

export function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function notify(): void {
  for (const l of listeners) l();
}
