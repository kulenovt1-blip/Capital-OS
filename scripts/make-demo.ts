/**
 * Демо-данные для режима «Посмотреть на демо-данных»: синтетический профиль «Студент» (tests/support/position-profiles.ts).
 *   bun scripts/make-demo.ts   → public/demo.json
 * Все цифры выдуманы; реальные данные в репозиторий не попадают.
 */
// @ts-nocheck — служебный скрипт для Bun
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { computeBalances, serializeState } from '../engine/index';
import { SPECS2, TODAY, build } from '../tests/support/position-profiles';

const state = { ...build(SPECS2[0]!), importedAt: TODAY };
// эталонные балансы = по операциям: на витрине сверка чистая
state.imported = { ...state.imported, reportedBalances: Object.fromEntries(state.imported.accounts.map((a) => [a.id, computeBalances(state.imported.operations).get(a.id) ?? 0])) };
state.settings = { ...state.settings, firstRunDone: true };
writeFileSync(join(import.meta.dir, '../public/demo.json'), serializeState(state, TODAY));
console.log(`public/demo.json · дата демо ${TODAY}`);
