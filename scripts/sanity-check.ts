/**
 * Проверка здравого смысла на любом бэкапе Capital OS (D107).
 *   bun scripts/sanity-check.ts путь/к/capital-os-ГГГГ-ММ-ДД.json [сегодня ГГГГ-ММ-ДД]
 * Печатает находки: fail — вывод приложения нельзя принимать на веру; warn — человек должен это видеть.
 * Файл только читается, ничего не сохраняется. Реальные бэкапы в репозиторий не класть.
 */
// @ts-nocheck — служебный скрипт для Bun
import { readFileSync } from 'node:fs';
import { parseState, sanityCheck } from '../engine/index';

const [file, todayArg] = process.argv.slice(2);
if (!file) {
  console.error('Укажи файл бэкапа: bun scripts/sanity-check.ts capital-os.json [ГГГГ-ММ-ДД]');
  process.exit(2);
}
const r = parseState(readFileSync(file, 'utf8'));
if (!r.ok) {
  console.error(r.error);
  process.exit(2);
}
const today = todayArg ?? new Date().toISOString().slice(0, 10);
const { findings } = sanityCheck(r.value, today);
if (!findings.length) console.log('Здравый смысл: замечаний нет');
for (const f of findings) console.log(`${f.level === 'fail' ? 'FAIL' : 'warn'}  ${f.id}\n      ${f.text}`);
process.exit(findings.some((f) => f.level === 'fail') ? 1 : 0);
