/**
 * Защита данных (D91): нечитаемое сохранённое состояние не превращается в «пустое» и не блокирует выход.
 * Сам IndexedDB проверяется в браузере (scripts/storage-check.ts); здесь — решения, от которых зависит, затрём ли мы данные.
 */
import { describe, it, expect } from 'vitest';
import { canWrite, decideLoad, errorText, looksLikeNewerVersion, quarantineKey } from '../../app/persist';
import { emptyState, serializeState } from '../../engine/state';

const TODAY = '2026-10-28';

describe('загрузка сохранённого состояния', () => {
  it('ничего не сохранено — пустое состояние, это не ошибка', () => {
    expect(decideLoad(undefined).kind).toBe('empty');
    expect(decideLoad(null).kind).toBe('empty');
    expect(decideLoad('').kind).toBe('empty');
  });

  it('нормальное состояние читается', () => {
    const s = { ...emptyState(), lastBackupAt: TODAY };
    const d = decideLoad(serializeState(s, TODAY));
    expect(d.kind).toBe('ok');
    if (d.kind === 'ok') expect(d.state.lastBackupAt).toBe(TODAY);
  });

  it('состояние от более новой версии — «нечитаемое», исходник сохраняется целиком, а не пустое состояние', () => {
    const obj = JSON.parse(serializeState({ ...emptyState(), lastBackupAt: TODAY }, TODAY));
    obj.version = 2;
    const raw = JSON.stringify(obj);
    const d = decideLoad(raw);
    expect(d.kind).toBe('unreadable');
    if (d.kind !== 'unreadable') return;
    expect(d.raw).toBe(raw);
    expect(looksLikeNewerVersion(d.error)).toBe(true);
  });

  it('повреждённый JSON — «нечитаемое», не пустое', () => {
    const d = decideLoad('{"app":"capital-os","version":1,"state":{');
    expect(d.kind).toBe('unreadable');
    if (d.kind === 'unreadable') expect(looksLikeNewerVersion(d.error)).toBe(false);
  });

  it('не строка (кто-то записал объект) — «нечитаемое», исходник сохраняется как JSON', () => {
    const d = decideLoad({ a: 1 });
    expect(d.kind).toBe('unreadable');
    if (d.kind === 'unreadable') expect(d.raw).toBe('{"a":1}');
  });
});

describe('запись', () => {
  it('при нечитаемых данных обычная запись запрещена, восстановление и «начать заново» — разрешены', () => {
    const bad = { mode: 'unreadable' as const, error: 'x', raw: 'x', savedAs: null };
    expect(canWrite(bad, false)).toBe(false);
    expect(canWrite(bad, true)).toBe(true);
    expect(canWrite({ mode: 'ok' }, false)).toBe(true);
    // запись однажды не удалась — пробовать снова можно (место могло освободиться)
    expect(canWrite({ mode: 'write-failed', error: 'x' }, false)).toBe(true);
  });

  it('копия нечитаемых данных: те же данные — тот же ключ (место не растёт), другие — другой (прежние не перезаписываются)', () => {
    const a = quarantineKey('{"app":"capital-os","version":2}');
    expect(quarantineKey('{"app":"capital-os","version":2}')).toBe(a);
    expect(quarantineKey('{"app":"capital-os","version":3}')).not.toBe(a);
    expect(a.startsWith('state.unreadable.')).toBe(true);
    expect(a).not.toBe('state');
  });

  it('нехватка места объясняется по-человечески', () => {
    expect(errorText(new DOMException('x', 'QuotaExceededError'))).toMatch(/не хватает места/);
    expect(errorText(new Error('сбой'))).toBe('сбой');
  });
});

describe('копия до переноса на новую модель экранов (D96)', () => {
  it('нужна для старого состояния, не нужна для перенесённого и пустого', async () => {
    const { needsPreSimpleCopy } = await import('../../app/persist');
    expect(needsPreSimpleCopy('{"state":{"settings":{}}}')).toBe(true);
    expect(needsPreSimpleCopy('{"state":{"settings":{"simpleMigrated": true}}}')).toBe(false);
    expect(needsPreSimpleCopy(serializeState(emptyState(), TODAY))).toBe(false);
    expect(needsPreSimpleCopy('')).toBe(false);
    expect(needsPreSimpleCopy(undefined)).toBe(false);
  });
});

describe('копия перед переносом обязательна (D103)', () => {
  const RAW = '{"app":"capital-os","version":1,"state":{}}';
  function fake(opts: { failSet?: boolean; corrupt?: boolean; existing?: string } = {}) {
    const m = new Map<string, unknown>(opts.existing ? [['state.before-simple', opts.existing]] : []);
    let writes = 0;
    return {
      writes: () => writes,
      store: {
        async get<T>(k: string) {
          return m.get(k) as T | undefined;
        },
        async set(k: string, v: unknown) {
          writes++;
          if (opts.failSet) throw new DOMException('нет места', 'QuotaExceededError');
          m.set(k, opts.corrupt ? String(v).slice(0, 5) : v);
        },
      },
    };
  }

  it('записалась и прочиталась так же — копия есть', async () => {
    const { ensurePreSimpleCopy } = await import('../../app/persist');
    const f = fake();
    expect(await ensurePreSimpleCopy(f.store, RAW)).toEqual({ ok: true });
  });

  it('запись упала или прочиталось не то — копии нет, запись приложения заблокирована', async () => {
    const { ensurePreSimpleCopy, canWrite } = await import('../../app/persist');
    const failed = await ensurePreSimpleCopy(fake({ failSet: true }).store, RAW);
    expect(failed.ok).toBe(false);
    const corrupt = await ensurePreSimpleCopy(fake({ corrupt: true }).store, RAW);
    expect(corrupt).toEqual({ ok: false, error: 'копия записалась не полностью' });
    const h = { mode: 'copy-failed' as const, error: 'x', raw: RAW };
    expect(canWrite(h, false)).toBe(false);
    expect(canWrite(h, true)).toBe(true);
  });

  it('копия уже есть — не перезаписывается', async () => {
    const { ensurePreSimpleCopy } = await import('../../app/persist');
    const f = fake({ existing: 'старая копия' });
    expect(await ensurePreSimpleCopy(f.store, RAW)).toEqual({ ok: true });
    expect(f.writes()).toBe(0);
  });
});
