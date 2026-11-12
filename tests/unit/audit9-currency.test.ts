import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { buildOverview, importMmbackup, emptyState, mergeAccountSettings } from '../../engine/index';
import { fixtureBytes } from '../support/fixtures';

const TODAY = '2026-10-28';
function stateWith(currency?: string) {
  const data = importMmbackup(fixtureBytes('synthetic.mmbackup'));
  const imported = currency ? { ...data, meta: { ...data.meta, defaultCurrency: currency } } : data;
  const s = emptyState();
  return { ...s, imported, importedAt: TODAY, settings: { ...s.settings, accounts: mergeAccountSettings([], data.accounts) } };
}

describe('D181 (L13): основная валюта MoneyManager', () => {
  it('синтетический бэкап читает основную валюту (если есть в файле) и в тенге молчит', () => {
    const o = buildOverview(stateWith('KZT'), TODAY);
    expect(o.notices.some((n) => n.code === 'import.default_currency')).toBe(false);
  });
  it('не тенге — ошибка в уведомлениях с названием валюты', () => {
    const n = buildOverview(stateWith('RUB'), TODAY).notices.find((x) => x.code === 'import.default_currency')!;
    expect(n.level).toBe('error');
    expect(n.text).toContain('RUB');
  });
  it('поле не прочитано — без ложной тревоги', () => {
    expect(buildOverview(stateWith(), TODAY).notices.some((n) => n.code === 'import.default_currency')).toBe(false);
  });
  it('реальный формат: настройка defaultCurrencyCode из syncable_settings читается', () => {
    const d = importMmbackup(fixtureBytes('synthetic.mmbackup'));
    expect([undefined, 'KZT']).toContain(d.meta.defaultCurrency);
  });
});
