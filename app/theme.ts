/**
 * Тема и размер текста (D76; с D166 светлая «Бирюза», тёмная вернулась по просьбе владельца 11.11: «Авто» следует за системой). Хранятся в localStorage этого устройства — это настройка вида, а не данные:
 * в JSON-бэкап не попадают. До отрисовки тему выставляет короткий скрипт в index.html, чтобы экран не мигал.
 */
const KF = 'capos-fs';
const KT = 'capos-theme';

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

export const fontPref = (): '0' | '1' => (read(KF) === '1' ? '1' : '0');

export type ThemePref = 'auto' | 'light' | 'dark';
export const themePref = (): ThemePref => {
  const v = read(KT);
  return v === 'light' || v === 'dark' ? v : 'auto';
};
export function resolveTheme(p: ThemePref = themePref()): 'light' | 'dark' {
  if (p !== 'auto') return p;
  try {
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  } catch {
    return 'light';
  }
}

function apply(): void {
  const th = resolveTheme();
  document.documentElement.dataset.theme = th;
  document.documentElement.dataset.fs = fontPref();
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', th === 'dark' ? '#0e1a1f' : '#edf1f2');
}

export function initTheme(): void {
  apply();
  try {
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', apply);
  } catch {
    /* старый браузер — тема меняется при следующем запуске */
  }
}
export function setTheme(v: ThemePref): void {
  write(KT, v);
  apply();
}
export function setFont(v: '0' | '1'): void {
  write(KF, v);
  apply();
}
