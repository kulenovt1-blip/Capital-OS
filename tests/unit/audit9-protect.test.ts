import { describe, expect, it } from 'vitest';
import { BACKUP_REMIND_DAYS, BACKUP_REMIND_DAYS_UNPROTECTED, backupReminder, persistLine, requestPersistence } from '../../app/persist';

describe('D176: постоянное хранилище', () => {
  it('нет API → unsupported; уже выдано → granted без повторного запроса', async () => {
    expect(await requestPersistence(undefined)).toBe('unsupported');
    expect(await requestPersistence({})).toBe('unsupported');
    let asked = 0;
    expect(await requestPersistence({ persisted: async () => true, persist: async () => (asked++, true) })).toBe('granted');
    expect(asked).toBe(0);
  });
  it('не выдано → просим; ответ браузера передаётся; ошибка не роняет', async () => {
    expect(await requestPersistence({ persisted: async () => false, persist: async () => true })).toBe('granted');
    expect(await requestPersistence({ persisted: async () => false, persist: async () => false })).toBe('denied');
    expect(await requestPersistence({ persist: async () => { throw new Error('x'); } })).toBe('unknown');
  });
});

describe('D176: напоминание о бэкапе', () => {
  it('нет данных — не напоминаем', () => {
    expect(backupReminder(null, false, 'denied').show).toBe(false);
  });
  it('защищено: напоминаем после 14 дней, не раньше', () => {
    expect(backupReminder(BACKUP_REMIND_DAYS, true, 'granted').show).toBe(false);
    expect(backupReminder(BACKUP_REMIND_DAYS + 1, true, 'granted').show).toBe(true);
  });
  it('не защищено: после 7 дней, а после 14 — срочно', () => {
    expect(backupReminder(BACKUP_REMIND_DAYS_UNPROTECTED, true, 'denied').show).toBe(false);
    const r = backupReminder(BACKUP_REMIND_DAYS_UNPROTECTED + 1, true, 'denied');
    expect(r.show).toBe(true);
    expect(r.level).toBe('warn');
    expect(backupReminder(2 * BACKUP_REMIND_DAYS_UNPROTECTED + 1, true, 'unsupported').level).toBe('bad');
  });
  it('бэкап ни разу: всегда напоминаем; без защиты — срочно', () => {
    expect(backupReminder(null, true, 'granted')).toMatchObject({ show: true, level: 'warn' });
    expect(backupReminder(null, true, 'denied')).toMatchObject({ show: true, level: 'bad' });
  });
  it('у каждого статуса есть строка', () => {
    for (const s of ['granted', 'denied', 'unsupported', 'unknown'] as const) expect(persistLine(s).length).toBeGreaterThan(20);
  });
});
