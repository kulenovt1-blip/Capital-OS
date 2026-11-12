import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { applySpikes, buildOverview, buildSimInput, parseSpikeId, parseState, spikeFacts, spikeId, sanityCheck, expensePart, tenge, type AppState } from '../../engine/index';
import { ensureNeverClass } from '../../engine/simple';

const demo = parseState(readFileSync(new URL('../../public/demo.json', import.meta.url), 'utf8'));
if (!demo.ok) throw new Error('demo.json');
const TODAY = '2026-11-04';

/** Демо + искусственный всплеск: 3 месяца лета по 120 000 ₸ в одной категории (D175). */
function withSpike(): { st: AppState; classId: string } {
  const st0 = demo.value;
  const o = buildOverview(st0, TODAY);
  const cls = new Map((o.classification?.ops ?? []).map((c) => [c.op.id, c.cls]));
  const src = st0.imported!.operations.find((x) => x.kind === 'expense' && cls.get(x.id) === 'E_base')!;
  const extra = ['2026-06', '2026-07', '2026-08'].map((m, i) => ({ ...src, id: `spike-${i}`, date: `${m}-12`, amount: tenge(120_000) }));
  const ops = [...st0.imported!.operations.filter((x) => !(x.date >= '2026-06-01' && x.date < '2026-09-01' && x.kind === 'expense' && cls.get(x.id) === 'E_base')), ...extra].sort((a, b) => (a.date < b.date ? -1 : 1));
  return { st: { ...st0, imported: { ...st0.imported!, operations: ops } }, classId: 'E_base' };
}

describe('D175: всплески трат', () => {
  it('id ответа разбирается обратно', () => {
    expect(parseSpikeId(spikeId('U_E_podarki', '2026-06', '2026-08'))).toEqual({ classId: 'U_E_podarki', from: '2026-06', to: '2026-08' });
    expect(parseSpikeId('мусор')).toBeNull();
  });

  it('три высоких месяца подряд — один всплеск с суммой и обычным месяцем', () => {
    const { st, classId } = withSpike();
    const f = spikeFacts(st, TODAY, buildOverview(st, TODAY)).find((x) => x.classId === classId)!;
    expect(f).toBeTruthy();
    expect(f.from).toBe('2026-06');
    expect(f.to).toBe('2026-08');
    expect(f.total).toBe(tenge(360_000));
    expect(f.median).toBeLessThan(tenge(120_000) / 2.5);
  });

  it('без всплеска вопроса нет; без ответа — fail в здравом смысле', () => {
    expect(spikeFacts(demo.value, TODAY, buildOverview(demo.value, TODAY)).length).toBe(0);
    const { st } = withSpike();
    expect(sanityCheck(st, TODAY).findings.some((x) => x.id === 'spike_unconfirmed' && x.level === 'fail')).toBe(true);
  });

  it('«разово»: операции всплеска выпадают из обычных трат, вопрос закрыт', () => {
    const { st, classId } = withSpike();
    const before = buildOverview(st, TODAY);
    const f = spikeFacts(st, TODAY, before).find((x) => x.classId === classId)!;
    const st2: AppState = { ...st, settings: { ...st.settings, classes: ensureNeverClass(st.settings.classes), spikes: { [f.id]: { kind: 'never' } } } };
    const after = buildOverview(st2, TODAY);
    expect(after.baseline.median).toBeLessThanOrEqual(before.baseline.median);
    expect(spikeFacts(st2, TODAY, after).some((x) => x.id === f.id)).toBe(false);
    expect(sanityCheck(st2, TODAY).findings.some((x) => x.id === 'spike_unconfirmed')).toBe(false);
    const moved = after.classification!.ops.filter((c) => c.cls === 'U_E_ne_povtoritsya').length;
    expect(moved).toBe(3);
  });

  it('«раз в год»: числа не меняются, вопрос закрыт', () => {
    const { st, classId } = withSpike();
    const o1 = buildOverview(st, TODAY);
    const f = spikeFacts(st, TODAY, o1).find((x) => x.classId === classId)!;
    const st2: AppState = { ...st, settings: { ...st.settings, spikes: { [f.id]: { kind: 'yearly' } } } };
    const o2 = buildOverview(st2, TODAY);
    expect(o2.baseline.median).toBe(o1.baseline.median);
    expect(spikeFacts(st2, TODAY, o2).some((x) => x.id === f.id)).toBe(false);
  });

  it('«своя сумма»: всплеск выпадает, в прогнозе строка «сумма / 12» как редкая трата', () => {
    const { st, classId } = withSpike();
    const f = spikeFacts(st, TODAY, buildOverview(st, TODAY)).find((x) => x.classId === classId)!;
    const st2: AppState = { ...st, settings: { ...st.settings, classes: ensureNeverClass(st.settings.classes), spikes: { [f.id]: { kind: 'custom', annual: tenge(120_000) } } } };
    const line = buildSimInput(st2, TODAY).input.expenses.find((e) => e.key.endsWith('#spike'))!;
    expect(line.monthly).toBe(tenge(10_000));
    expect(expensePart(st2, line.key)).toBe('rare');
  });

  it('applySpikes без правил возвращает те же операции', () => {
    const ops = buildOverview(demo.value, TODAY).classification!.ops;
    expect(applySpikes(ops, undefined)).toBe(ops);
    expect(applySpikes(ops, { x: { kind: 'yearly' } })).toBe(ops);
  });
});
