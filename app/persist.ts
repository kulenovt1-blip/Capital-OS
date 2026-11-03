/**
 * Решения о загрузке и сохранении состояния — без DOM и без IndexedDB, чтобы их можно было проверить тестами (D91).
 *
 * Правило: данные пользователя никогда не затираются молча.
 *  - сохранённое состояние не прочиталось → приложение не стартует «пустым поверх», исходник откладывается
 *    под отдельный ключ, и человек сам решает, что делать (скачать, восстановить из бэкапа, начать заново);
 *  - запись не удалась → человек видит это сразу, а изменения остаются в памяти, чтобы их можно было скачать бэкапом.
 */
import { parseState, type AppState } from '../engine/index';

export type LoadDecision =
  | { kind: 'empty' }
  | { kind: 'ok'; state: AppState }
  | { kind: 'unreadable'; error: string; raw: string };

/** Что делать с тем, что лежит в хранилище под ключом состояния. */
export function decideLoad(raw: unknown): LoadDecision {
  if (raw === undefined || raw === null || raw === '') return { kind: 'empty' };
  if (typeof raw !== 'string') return { kind: 'unreadable', error: 'Сохранённые данные не в том формате', raw: safeStringify(raw) };
  const r = parseState(raw);
  return r.ok ? { kind: 'ok', state: r.value } : { kind: 'unreadable', error: r.error, raw };
}

/** Ключ копии состояния до переноса на новую модель экранов (D96). */
export const PRE_SIMPLE_KEY = 'state.before-simple';

/** Сохранённое состояние ещё не перенесено на новую модель экранов — перед первой записью отложить копию (D96). */
export function needsPreSimpleCopy(raw: unknown): boolean {
  return typeof raw === 'string' && raw.length > 0 && !/"simpleMigrated":\s*true/.test(raw);
}

/** Минимум хранилища, нужный для копии (в тестах — подделка). */
export interface KvStore {
  get<T>(key: string): Promise<T | undefined>;
  set(key: string, value: unknown): Promise<void>;
}

/**
 * Копия исходных данных перед переносом (D103): записать и прочитать обратно — копия считается сделанной,
 * только если прочитанное совпадает с исходником байт в байт. Уже лежащая копия — не перезаписывается.
 * Не получилось — перенос не начинается: приложение работает только на чтение, пока копия не будет сделана.
 */
export async function ensurePreSimpleCopy(store: KvStore, raw: string): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const existing = await store.get<string>(PRE_SIMPLE_KEY);
    if (typeof existing === 'string' && existing.length > 0) return { ok: true };
    await store.set(PRE_SIMPLE_KEY, raw);
    const back = await store.get<string>(PRE_SIMPLE_KEY);
    if (back !== raw) return { ok: false, error: 'копия записалась не полностью' };
    return { ok: true };
  } catch (e) {
    return { ok: false, error: errorText(e) };
  }
}

/**
 * Ключ, под которым откладывается нечитаемое состояние: по содержимому (FNV-1a + длина).
 * Те же данные при повторных открытиях — та же копия (место не растёт), другие данные — другая копия (прежние не перезаписываются).
 */
export function quarantineKey(raw: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < raw.length; i++) {
    h ^= raw.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return `state.unreadable.${h.toString(16).padStart(8, '0')}-${raw.length}`;
}

/** Состояние хранения, которое видит интерфейс. */
export type StorageHealth =
  | { mode: 'ok' }
  /** Сохранённое не прочиталось. Запись заблокирована, пока человек не выберет выход. */
  | { mode: 'unreadable'; error: string; raw: string; savedAs: string | null }
  /** Запись не удалась (место, запрет браузера). Изменения только в памяти. */
  | { mode: 'write-failed'; error: string }
  /** Хранилище браузера недоступно совсем. Работаем в памяти. */
  | { mode: 'no-storage'; error: string }
  /** Перед переносом на новую модель не удалось сделать копию (D103). Только чтение, пока копия не сделана. */
  | { mode: 'copy-failed'; error: string; raw: string };

/** Можно ли сейчас писать обычные изменения. Восстановление из бэкапа и «начать заново» разрешены всегда (force). */
export function canWrite(h: StorageHealth, force: boolean): boolean {
  return force || (h.mode !== 'unreadable' && h.mode !== 'copy-failed');
}

/** Похоже ли, что данные записала более новая версия приложения (тогда помогает обновить страницу). */
export function looksLikeNewerVersion(error: string): boolean {
  return /более новой версии/.test(error);
}

export function errorText(e: unknown): string {
  if (e instanceof DOMException && e.name === 'QuotaExceededError') return 'на устройстве не хватает места для данных браузера';
  if (e instanceof Error) return e.message || e.name;
  return String(e);
}

function safeStringify(v: unknown): string {
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}
