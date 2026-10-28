import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/** Абсолютный путь к файлу в tests/fixtures. */
export function fixturePath(rel: string): string {
  return fileURLToPath(new URL(`../fixtures/${rel}`, import.meta.url));
}

export function fixtureBytes(rel: string): Uint8Array {
  return new Uint8Array(readFileSync(fixturePath(rel)));
}

export function fixtureJson<T = any>(rel: string): T {
  return JSON.parse(readFileSync(fixturePath(rel), 'utf8')) as T;
}
