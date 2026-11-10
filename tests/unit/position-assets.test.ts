/**
 * T04 «Положение» v4: вид актива у ручных счетов и признаки дохода («не зависит от труда», «из этих активов», «индексируется»).
 *
 * Критерии: старые счета и доходы без новых полей ведут себя как раньше (бэкап читается и пишется побайтно, прогноз и ряды
 * не меняются); недопустимые значения отбрасываются с предупреждением; для каждого нового поля определено поведение «не указано».
 * Ожидаемые значения — из спецификации (position-spec-v4-b, раздел 10.1 и 14; position-spec-v3, раздел 10.3), посчитаны вручную.
 */
import { describe, it, expect } from 'vitest';
import { createHash } from 'node:crypto';
import { emptyState, parseState, serializeState } from '../../engine/state';
import { importMmbackup } from '../../engine/import/mmbackup';
import { mergeAccountSettings, type IncomeScheduleItem, type ManualAccount } from '../../engine/settings';
import {
  ASSET_KINDS,
  DEFAULT_ASSET_KIND,
  assetKindOf,
  incomeIndexFactor,
  incomeOrigin,
  isAssetKind,
  normalizeAssetKinds,
  normalizeIncomeFlags,
} from '../../engine/position/settings';
import { buildSimInput } from '../../engine/plan';
import { DEFAULT_SCENARIOS, simulate } from '../../engine/simulate';
import { buildPositionSeries } from '../../engine/position/series';
import { tenge } from '../../engine/money';
import { fixtureBytes } from '../support/fixtures';
import { applyProbeOpts, probeProfiles, TODAY } from '../support/position-profiles';

const STAMP = '2026-11-05';
const acc = (over: Record<string, unknown> = {}): ManualAccount =>
  ({ id: 'm1', title: 'Вклад вручную', balance: tenge(5_000), balanceDate: '2026-10-01', liquidity: { kind: 'instant' }, comment: 'вручную', ...over }) as ManualAccount;
const inc = (over: Record<string, unknown> = {}): IncomeScheduleItem =>
  ({ id: 'i1', title: 'Дивиденды', dayOfMonth: 10, amount: tenge(100_000), kind: 'stable', ...over }) as IncomeScheduleItem;

function parsedWith(mutate: (state: Record<string, any>) => void) {
  const obj = JSON.parse(serializeState(emptyState(), STAMP));
  mutate(obj.state);
  return parseState(JSON.stringify(obj));
}

describe('вид актива: допустимые значения', () => {
  it('четыре вида: наличные, вклад, ценные бумаги, неинвестируемое', () => {
    expect([...ASSET_KINDS]).toEqual(['cash', 'deposit', 'securities', 'non_investable']);
    for (const k of ASSET_KINDS) expect(isAssetKind(k)).toBe(true);
    for (const bad of ['stocks', '', 'Cash', null, undefined, 1, true, {}]) expect(isAssetKind(bad)).toBe(false);
  });

  it('«не указано» = вклад (консервативная ставка, спецификация 10.3); явный вид возвращается как есть', () => {
    expect(DEFAULT_ASSET_KIND).toBe('deposit');
    expect(assetKindOf(acc())).toBe('deposit');
    for (const k of ASSET_KINDS) expect(assetKindOf(acc({ assetKind: k }))).toBe(k);
  });
});

describe('normalizeAssetKinds', () => {
  it('счета без поля не пересоздаются (тот же объект), предупреждений нет', () => {
    const a = acc();
    const r = normalizeAssetKinds([a]);
    expect(r.items[0]).toBe(a);
    expect(r.warnings).toEqual([]);
  });

  it('допустимый вид сохраняется', () => {
    const a = acc({ assetKind: 'securities' });
    const r = normalizeAssetKinds([a]);
    expect(r.items[0]).toBe(a);
    expect(r.warnings).toEqual([]);
  });

  it('недопустимый вид отбрасывается с предупреждением, остальные поля счёта целы', () => {
    const r = normalizeAssetKinds([acc({ assetKind: 'stocks' })]);
    expect('assetKind' in r.items[0]!).toBe(false);
    expect(r.items[0]!.balance).toBe(tenge(5_000));
    expect(r.warnings.map((w) => w.code)).toEqual(['account.assetKind.dropped']);
    expect(r.warnings[0]!.level).toBe('warn');
  });

  it('null — «нет значения» без предупреждения; поле убирается', () => {
    const r = normalizeAssetKinds([acc({ assetKind: null })]);
    expect('assetKind' in r.items[0]!).toBe(false);
    expect(r.warnings).toEqual([]);
  });

  it('идемпотентна: повторный вызов на результате не даёт предупреждений и не меняет его', () => {
    const first = normalizeAssetKinds([acc({ assetKind: 'bad' }), acc({ id: 'm2', assetKind: 'cash' })]);
    const again = normalizeAssetKinds(first.items);
    expect(again.warnings).toEqual([]);
    expect(again.items).toEqual(first.items);
  });
});

describe('признаки дохода: «не зависит от труда» и «из этих активов»', () => {
  it('«не указано» у всех полей — доход от труда: в независимые поступления не входит', () => {
    expect(incomeOrigin(inc())).toBe('labor');
    expect(incomeOrigin(inc({ passive: false }))).toBe('labor');
    expect(incomeOrigin(inc({ passive: false, fromAssets: false }))).toBe('labor');
  });

  it('пассивный, происхождение не указано — считается доходом с этих же активов (консервативно: иначе капитал посчитан дважды)', () => {
    expect(incomeOrigin(inc({ passive: true }))).toBe('from_assets');
    expect(incomeOrigin(inc({ passive: true, fromAssets: true }))).toBe('from_assets');
  });

  it('пассивный и явно «не из этих активов» (пенсия, рента) — независимый: входит в `P`', () => {
    expect(incomeOrigin(inc({ passive: true, fromAssets: false }))).toBe('independent');
  });

  it('«индексируется»: да — 1, нет или не указано — 0,5 (спецификация 10.1)', () => {
    expect(incomeIndexFactor(inc({ indexed: true }))).toBe(1);
    expect(incomeIndexFactor(inc({ indexed: false }))).toBe(0.5);
    expect(incomeIndexFactor(inc())).toBe(0.5);
  });
});

describe('normalizeIncomeFlags', () => {
  it('доходы без полей не пересоздаются, допустимые значения сохраняются', () => {
    const a = inc();
    const b = inc({ id: 'i2', passive: true, fromAssets: false });
    const r = normalizeIncomeFlags([a, b]);
    expect(r.items[0]).toBe(a);
    expect(r.items[1]).toBe(b);
    expect(r.warnings).toEqual([]);
  });

  it('не логическое значение отбрасывается с предупреждением, годные поля остаются', () => {
    const r = normalizeIncomeFlags([inc({ passive: 'yes', fromAssets: false })]);
    expect('passive' in r.items[0]!).toBe(false);
    expect(r.items[0]!.fromAssets).toBe(false);
    expect(r.warnings.map((w) => w.code)).toEqual(['income.passive.dropped']);
  });

  it('оба поля плохие — два предупреждения; null — без предупреждения', () => {
    const r = normalizeIncomeFlags([inc({ passive: 1, fromAssets: 'нет' }), inc({ id: 'i2', passive: null, fromAssets: null })]);
    expect(r.warnings.map((w) => w.code)).toEqual(['income.passive.dropped', 'income.fromAssets.dropped']);
    expect('passive' in r.items[1]! || 'fromAssets' in r.items[1]!).toBe(false);
  });

  it('признак «из этих активов» без «не зависит от труда» хранится как есть, но на происхождение не влияет', () => {
    const r = normalizeIncomeFlags([inc({ fromAssets: false })]);
    expect(r.items[0]!.fromAssets).toBe(false);
    expect(incomeOrigin(r.items[0]!)).toBe('labor');
  });

  it('идемпотентна', () => {
    const first = normalizeIncomeFlags([inc({ passive: 'x', fromAssets: 3 })]);
    const again = normalizeIncomeFlags(first.items);
    expect(again.warnings).toEqual([]);
    expect(again.items).toEqual(first.items);
  });
});

describe('в состоянии: чтение и запись', () => {
  it('старое состояние (без новых полей) читается и записывается обратно побайтно', () => {
    const data = importMmbackup(fixtureBytes('synthetic.mmbackup'));
    const s = emptyState();
    const state = { ...s, imported: data, importedAt: STAMP, manualAccounts: [acc()], settings: { ...s.settings, accounts: mergeAccountSettings([], data.accounts), incomeSchedule: [inc()] } };
    const before = serializeState(state, STAMP);
    const r = parseState(before);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(serializeState(r.value, STAMP)).toBe(before);
    expect('assetKind' in r.value.manualAccounts[0]!).toBe(false);
    expect('passive' in r.value.settings.incomeSchedule[0]!).toBe(false);
    expect(r.explanation.every((e) => e.level !== 'warn')).toBe(true);
  });

  it('новые поля переживают запись и чтение побайтно', () => {
    const s = emptyState();
    s.manualAccounts = [acc({ assetKind: 'securities' })];
    s.settings.incomeSchedule = [inc({ passive: true, fromAssets: true, indexed: false }), inc({ id: 'i2', title: 'Пенсия', passive: true, fromAssets: false, indexed: true })];
    const text = serializeState(s, STAMP);
    const r = parseState(text);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.manualAccounts[0]!.assetKind).toBe('securities');
    expect(r.value.settings.incomeSchedule.map((x) => [x.passive, x.fromAssets, x.indexed])).toEqual([[true, true, false], [true, false, true]]);
    expect(serializeState(r.value, STAMP)).toBe(text);
  });

  it('недопустимые значения отбрасываются, бэкап читается, предупреждения видны', () => {
    const r = parsedWith((st) => {
      st.manualAccounts = [acc({ assetKind: 'gold' })];
      st.settings.incomeSchedule = [inc({ passive: 'да', fromAssets: 7 })];
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect('assetKind' in r.value.manualAccounts[0]!).toBe(false);
    expect('passive' in r.value.settings.incomeSchedule[0]!).toBe(false);
    expect('fromAssets' in r.value.settings.incomeSchedule[0]!).toBe(false);
    expect(r.explanation.filter((e) => e.level === 'warn').map((e) => e.code)).toEqual(['account.assetKind.dropped', 'income.passive.dropped', 'income.fromAssets.dropped']);
  });

  it('повторное чтение результата не даёт новых предупреждений', () => {
    const first = parsedWith((st) => {
      st.manualAccounts = [acc({ assetKind: 'gold' })];
      st.settings.incomeSchedule = [inc({ passive: 'да' })];
    });
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    const again = parseState(serializeState(first.value, STAMP));
    expect(again.ok).toBe(true);
    if (!again.ok) return;
    expect(again.explanation.filter((e) => e.level === 'warn')).toEqual([]);
  });
});

describe('новые поля не меняют прогноз и ряды (на них опирается только независимость, T10)', () => {
  const rep = (_k: string, v: unknown) => (v instanceof Map ? [...v.entries()] : v === undefined ? null : v);
  const sha = (x: unknown) => createHash('sha1').update(JSON.stringify(x, rep)).digest('hex');

  for (const p of probeProfiles().filter((_, i) => i % 9 === 0)) {
    it(p.name, () => {
      const plain = applyProbeOpts(p.state, p.opts);
      const flagged = {
        ...plain,
        manualAccounts: plain.manualAccounts.map((m, i) => ({ ...m, assetKind: ASSET_KINDS[i % ASSET_KINDS.length]! })),
        settings: { ...plain.settings, incomeSchedule: plain.settings.incomeSchedule.map((x, i) => ({ ...x, passive: i % 2 === 0, fromAssets: i % 3 === 0 })) },
      };
      const a = buildSimInput(plain, TODAY).input;
      const b = buildSimInput(flagged, TODAY).input;
      for (const sc of DEFAULT_SCENARIOS) expect(sha(simulate(b, sc))).toBe(sha(simulate(a, sc)));
      expect(buildPositionSeries(flagged, TODAY)).toEqual(buildPositionSeries(plain, TODAY));
    });
  }
});
