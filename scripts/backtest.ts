/**
 * Бэктест «обычных трат до дохода» (аудит 9, проверка наивности).
 *   bun scripts/backtest.ts путь/к/capital-os-ГГГГ-ММ-ДД.json [шаг_дней=3]
 * Для каждого прошлого дня d: считает «обычные траты до следующего дохода» ТОЛЬКО по данным до d и сравнивает
 * с фактическими тратами от d до даты дохода. Ошибка = прогноз − факт (плюс — прогноз завышал траты, свободных денег реально больше).
 * Файл только читается.
 */
// @ts-nocheck — служебный скрипт для Bun
import { readFileSync } from 'node:fs';
import { parseState, buildOverview, addDays, classGroup, daysBetween, classRegistry, baseClassIds, regularClassIds, UNCHECKED_CLASS_ID } from '../engine/index';

const [file, stepArg] = process.argv.slice(2);
if (!file) { console.error('Укажи файл бэкапа'); process.exit(2); }
const step = Number(stepArg ?? 3);
const r = parseState(readFileSync(file, 'utf8'));
if (!r.ok) { console.error(r.error); process.exit(2); }
const state = r.value;
const full = state.imported;
if (!full) { console.error('В бэкапе нет импортированных операций'); process.exit(2); }
const today = new Date().toISOString().slice(0, 10);
const last = full.operations.reduce((m, o) => (o.date > m ? o.date : m), '0000-00-00');
const first = full.operations.reduce((m, o) => (o.date < m ? o.date : m), '9999-99-99');
const ovFull = buildOverview(state, last);
const cls = new Map((ovFull.classification?.ops ?? []).map((c) => [c.op.id, c.cls]));
const amt = (o) => (o.kind === 'transfer' ? 0 : o.amount);
const reg = classRegistry(state.settings.classes);
const usualSet = new Set([...baseClassIds(reg, last), ...regularClassIds(reg, last), UNCHECKED_CLASS_ID]);
const spentIn = (from, to, only) => full.operations.filter((o) => o.date > from && o.date <= to && o.kind === 'expense' && classGroup(cls.get(o.id)) === 'expense' && (!only || usualSet.has(cls.get(o.id)))).reduce((a, o) => a + amt(o), 0);
const expenseIn = (from, to) => spentIn(from, to, true);
const byClass = {};

const rows = [];
for (let d = addDays(first, 200); d < addDays(last, -35); d = addDays(d, step)) {
  const cut = { ...state, imported: { ...full, operations: full.operations.filter((o) => o.date <= d) } };
  const o = buildOverview(cut, d);
  const end = o.nextIncome.date;
  if (end > last) continue;
  const predicted = o.spend.usualUntilIncome ?? 0;
  const actual = expenseIn(d, end);
  const allExp = spentIn(d, end, false);
  byClass.other = (byClass.other ?? 0) + (allExp - actual) / 100; byClass.usual = (byClass.usual ?? 0) + actual / 100;
  rows.push({ d, days: daysBetween(d, end), predicted: predicted / 100, actual: actual / 100 });
}
if (!rows.length) { console.log('Мало истории для бэктеста (нужно ≥ 7 месяцев и расписание доходов)'); process.exit(0); }
const pct = (a, p) => { const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(p * s.length))]; };
const err = rows.map((x) => (x.actual > 0 ? (x.predicted - x.actual) / x.actual : 0));
const mape = err.reduce((a, e) => a + Math.abs(e), 0) / err.length;
const bias = err.reduce((a, e) => a + e, 0) / err.length;
const under = err.filter((e) => e < -0.2).length / err.length;
const fmt = (v) => `${(v * 100).toFixed(0)}%`;
console.log(`Точек: ${rows.length}, шаг ${step} дн.`);
console.log(`Средняя ошибка (по модулю): ${fmt(mape)}; смещение: ${fmt(bias)} (плюс — прогноз трат завышен)`);
console.log(`Ошибка p10 / медиана / p90: ${fmt(pct(err, 0.1))} / ${fmt(pct(err, 0.5))} / ${fmt(pct(err, 0.9))}`);
console.log(`Доля точек, где реальные траты больше прогноза более чем на 20%: ${fmt(under)}`);
const byHorizon = [[1, 7], [8, 14], [15, 22], [23, 40]].map(([a, b]) => {
  const g = rows.filter((x) => x.days >= a && x.days <= b); if (!g.length) return null;
  const e = g.map((x) => (x.actual > 0 ? (x.predicted - x.actual) / x.actual : 0));
  return `${a}–${b} дн.: n=${g.length}, средняя |ошибка| ${fmt(e.reduce((s, v) => s + Math.abs(v), 0) / e.length)}, смещение ${fmt(e.reduce((s, v) => s + v, 0) / e.length)}`;
}).filter(Boolean);
console.log(byHorizon.join('\n'));
console.log(`Траты вне «обычных» классов (платежи, разовое): ${fmt(byClass.other / Math.max(1, byClass.usual + byClass.other))} всех фактических трат — в прогноз «обычных» не входят`);
