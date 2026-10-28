/**
 * Золотой тест на реальном бэкапе. Файл НЕ коммитится; путь берётся из окружения:
 *   CAPITAL_OS_BACKUP=/путь/к/файлу.mmbackup npm test
 * Без переменной тест пропускается.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { importMmbackup } from '../../engine/import/mmbackup';
import { reconcileAccounts } from '../../engine/ledger';
import { explanationToText } from '../../engine/explain';

const path = process.env.CAPITAL_OS_BACKUP;

describe('золотой тест: реальный бэкап MoneyManager', () => {
  it.skipIf(!path)('каждый счёт сходится с account_balance до тиына', () => {
    const data = importMmbackup(new Uint8Array(readFileSync(path!)));
    const rep = reconcileAccounts(data);
    if (!rep.ok) console.log(explanationToText(rep.explanation));
    if (data.warnings.length) console.log(data.warnings.map((w) => w.text).join('\n'));
    expect(rep.accounts.length).toBeGreaterThan(0);
    expect(rep.accounts.filter((a) => a.status !== 'ok')).toEqual([]);
  });
});
