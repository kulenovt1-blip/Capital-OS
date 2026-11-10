/**
 * Тема и размер текста (D76; тема с D152 одна — тёмная B1). Хранятся в localStorage этого устройства — это настройка вида, а не данные:
 * в JSON-бэкап не попадают. До отрисовки тему выставляет короткий скрипт в index.html, чтобы экран не мигал.
 */
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

export const fontPref = (): '0' | '1' => (read(KF) === '1' ? '1' : '0');

function apply(): void {
  document.documentElement.dataset.theme = 'dark';
  document.documentElement.dataset.fs = fontPref();
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', '#0b110d');
}

export function initTheme(): void {
  apply();
}
export function setFont(v: '0' | '1'): void {
  write(KF, v);
  apply();
}
