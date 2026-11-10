/**
 * T01 «Положение» v4: необязательные настройки `Settings.position` (возраст, «хочу тратить в месяц»).
 * Критерии: старое состояние читается без изменений и записывается обратно побайтно; значения вне диапазона
 * отбрасываются с предупреждением; `desiredMonthly` — целое число тиынов; `STATE_VERSION` не меняется.
 */
import { describe, it, expect } from 'vitest';
import { emptyState, parseState, serializeState, STATE_VERSION } from '../../engine/state';
import { importMmbackup } from '../../engine/import/mmbackup';
import { mergeAccountSettings } from '../../engine/settings';
import { normalizePositionSettings, POSITION_AGE_MAX, POSITION_AGE_MIN } from '../../engine/position/settings';
import { tenge } from '../../engine/money';
import { fixtureBytes } from '../support/fixtures';

const TODAY = '2026-11-05';

function withPosition(position: unknown): string {
  const obj = JSON.parse(serializeState(emptyState(), TODAY));
  obj.state.settings.position = position;
  return JSON.stringify(obj);
}

describe('normalizePositionSettings', () => {
  it('нет настройки — нет значения и нет предупреждений', () => {
    expect(normalizePositionSettings(undefined)).toEqual({ value: undefined, warnings: [] });
    expect(normalizePositionSettings(null)).toEqual({ value: undefined, warnings: [] });
  });

  it('пустой объект — настройки нет (ключ не хранится)', () => {
    expect(normalizePositionSettings({})).toEqual({ value: undefined, warnings: [] });
  });

  it('корректные значения сохраняются как есть', () => {
    const r = normalizePositionSettings({ age: 34, desiredMonthly: tenge(600_000) });
    expect(r.value).toEqual({ age: 34, desiredMonthly: tenge(600_000) });
    expect(r.warnings).toEqual([]);
  });

  it('возраст на границах допустим, за границами — отбрасывается с предупреждением', () => {
    expect(POSITION_AGE_MIN).toBe(14);
    expect(POSITION_AGE_MAX).toBe(100);
    expect(normalizePositionSettings({ age: POSITION_AGE_MIN }).value).toEqual({ age: POSITION_AGE_MIN });
    expect(normalizePositionSettings({ age: POSITION_AGE_MAX }).value).toEqual({ age: POSITION_AGE_MAX });
    for (const bad of [POSITION_AGE_MIN - 1, POSITION_AGE_MAX + 1, 0, -5, 34.5, Number.NaN, Infinity, '34', true]) {
      const r = normalizePositionSettings({ age: bad });
      expect(r.value).toBeUndefined();
      expect(r.warnings).toHaveLength(1);
      expect(r.warnings[0].level).toBe('warn');
      expect(r.warnings[0].code).toBe('position.age.dropped');
    }
  });

  it('«хочу тратить в месяц»: только целые положительные тиыны', () => {
    for (const bad of [0, -100, 1.5, Number.NaN, Infinity, '600000', null, {}]) {
      const r = normalizePositionSettings({ desiredMonthly: bad });
      expect(r.value).toBeUndefined();
      expect(r.warnings.map((w) => w.code)).toEqual(bad === null ? [] : ['position.desiredMonthly.dropped']);
    }
  });

  it('одно поле плохое, другое хорошее — хорошее остаётся', () => {
    const r = normalizePositionSettings({ age: 7, desiredMonthly: tenge(400_000) });
    expect(r.value).toEqual({ desiredMonthly: tenge(400_000) });
    expect(r.warnings.map((w) => w.code)).toEqual(['position.age.dropped']);
  });

  it('не объект — отбрасывается целиком с предупреждением', () => {
    for (const bad of [42, 'x', true, [1, 2]]) {
      const r = normalizePositionSettings(bad);
      expect(r.value).toBeUndefined();
      expect(r.warnings.map((w) => w.code)).toEqual(['position.dropped']);
    }
  });

  it('лишние ключи не переносятся (в том числе состояние гистерезиса — его нет)', () => {
    const r = normalizePositionSettings({ age: 40, shown: 'L4', hysteresis: 1 });
    expect(r.value).toEqual({ age: 40 });
    expect(r.warnings).toEqual([]);
  });
});

describe('Settings.position в состоянии', () => {
  it('STATE_VERSION остаётся 1', () => {
    expect(STATE_VERSION).toBe(1);
  });

  it('пустое состояние не содержит ключа position', () => {
    expect('position' in emptyState().settings).toBe(false);
  });

  it('старое состояние (без position) читается и записывается обратно побайтно', () => {
    const data = importMmbackup(fixtureBytes('synthetic.mmbackup'));
    const s = emptyState();
    const state = { ...s, imported: data, importedAt: TODAY, settings: { ...s.settings, accounts: mergeAccountSettings([], data.accounts) } };
    const before = serializeState(state, TODAY);
    const r = parseState(before);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(serializeState(r.value, TODAY)).toBe(before);
    expect(r.value.settings.position).toBeUndefined();
    expect(r.explanation.every((e) => e.level !== 'warn')).toBe(true);
  });

  it('корректная настройка переживает запись и чтение побайтно', () => {
    const s = emptyState();
    s.settings.position = { age: 29, desiredMonthly: tenge(550_000) };
    const text = serializeState(s, TODAY);
    const r = parseState(text);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.settings.position).toEqual({ age: 29, desiredMonthly: tenge(550_000) });
    expect(serializeState(r.value, TODAY)).toBe(text);
  });

  it('значения вне диапазона отбрасываются, бэкап читается, предупреждения видны', () => {
    const r = parseState(withPosition({ age: 250, desiredMonthly: 1.5 }));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.settings.position).toBeUndefined();
    expect('position' in r.value.settings).toBe(false);
    const warns = r.explanation.filter((e) => e.level === 'warn').map((e) => e.code);
    expect(warns).toEqual(['position.age.dropped', 'position.desiredMonthly.dropped']);
  });

  it('повторное чтение результата не даёт новых предупреждений (нормализация идемпотентна)', () => {
    const first = parseState(withPosition({ age: 250, desiredMonthly: tenge(100_000) }));
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    const again = parseState(serializeState(first.value, TODAY));
    expect(again.ok).toBe(true);
    if (!again.ok) return;
    expect(again.explanation.filter((e) => e.level === 'warn')).toEqual([]);
    expect(again.value.settings.position).toEqual({ desiredMonthly: tenge(100_000) });
  });
});
