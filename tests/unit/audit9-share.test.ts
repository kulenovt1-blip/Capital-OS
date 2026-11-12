import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

describe('D183: Поделиться → Capital OS', () => {
  const manifest = JSON.parse(readFileSync('public/manifest.webmanifest', 'utf8'));
  const sw = readFileSync('public/sw.js', 'utf8');
  it('манифест принимает файл POST-ом', () => {
    expect(manifest.share_target.method).toBe('POST');
    expect(manifest.share_target.enctype).toBe('multipart/form-data');
    expect(manifest.share_target.params.files[0].name).toBe('file');
    expect(manifest.share_target.action).toBe('./share-target');
  });
  it('service worker принимает POST, прячет файл и открывает импорт; кэш файла не чистится при обновлении', () => {
    expect(sw).toContain("endsWith('/share-target')");
    expect(sw).toContain('#/import');
    expect(sw).toContain('k !== SHARE');
  });
});
