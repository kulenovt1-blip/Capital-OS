/**
 * Свежесть данных (аудит 9, U1; D180): числа «сейчас» верны, пока в MoneyManager нет новых операций.
 * Приложение не может узнать об этом само, поэтому считает дни от последнего импорта и говорит об этом вслух.
 */
import { daysBetween, type IsoDate } from './date';

/** Не старше стольких дней — молчим. */
export const FRESH_DAYS = 3;
/** Старше — «устарело», на «Обзоре» заметная плашка. */
export const STALE_DAYS = 7;

export type Freshness = { days: number | null; level: 'none' | 'fresh' | 'aging' | 'stale' };

export function dataFreshness(importedAt: IsoDate | null, today: IsoDate): Freshness {
  if (!importedAt) return { days: null, level: 'none' };
  const days = Math.max(0, daysBetween(importedAt, today));
  return { days, level: days <= FRESH_DAYS ? 'fresh' : days <= STALE_DAYS ? 'aging' : 'stale' };
}
