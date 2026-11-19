/**
 * Демо-персонажи «Примерь на себя»: пять синтетических профилей (tests/support/personas.ts).
 *   bun scripts/make-personas.ts   → public/personas/{berik,serik,aliya,olzhas,dantal}.json
 * Все цифры выдуманы; реальные данные в репозиторий не попадают.
 */
// @ts-nocheck — служебный скрипт для Bun
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { computeBalances, serializeState } from '../engine/index';
import { PERSONAS, PERSONA_TODAY, personaState } from '../tests/support/personas';

const dir = join(import.meta.dir, '../public/personas');
mkdirSync(dir, { recursive: true });
for (const p of PERSONAS) {
  const state = { ...personaState(p.id), importedAt: PERSONA_TODAY };
  // эталонные балансы = по операциям: у примера сверка чистая
  state.imported = { ...state.imported, reportedBalances: Object.fromEntries(state.imported.accounts.map((a) => [a.id, computeBalances(state.imported.operations).get(a.id) ?? 0])) };
  writeFileSync(join(dir, `${p.id}.json`), serializeState(state, PERSONA_TODAY));
  console.log(`public/personas/${p.id}.json · ${p.name}`);
}
