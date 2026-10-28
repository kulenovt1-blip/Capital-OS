/**
 * Тема и размер текста (D76). Хранятся в localStorage этого устройства — это настройка вида, а не данные:
 * в JSON-бэкап не попадают. До отрисовки тему выставляет короткий скрипт в index.html, чтобы экран не мигал.
 */
export type ThemePref = 'auto' | 'light' | 'dark';
const KT = 'capos-theme';
const KF = 'capos-fs';

const read = (k: string): string | null => {
  try {
    return localStorage.getItem(k);
  } catch {
    return null;
  }
};
const write = (k: string, v: string): void => {
  try {
    localStorage.setItem(k, v);
  } catch {
    /* хранилище недоступно — настройка действует до перезагрузки */
  }
};

export const themePref = (): ThemePref => {
  const v = read(KT);
  return v === 'light' || v === 'dark' ? v : 'auto';
};
export const fontPref = (): '0' | '1' => (read(KF) === '1' ? '1' : '0');

function apply(): void {
  const p = themePref();
  const dark = p === 'dark' || (p === 'auto' && window.matchMedia?.('(prefers-color-scheme: dark)').matches);
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  document.documentElement.dataset.fs = fontPref();
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', dark ? '#0e100e' : '#f4f4ef');
}

export function initTheme(): void {
  apply();
  window.matchMedia?.('(prefers-color-scheme: dark)').addEventListener?.('change', apply);
}
export function setTheme(p: ThemePref): void {
  write(KT, p);
  apply();
}
export function setFont(v: '0' | '1'): void {
  write(KF, v);
  apply();
}
