export type DesktopTheme = 'dark' | 'light';

const STORAGE_KEY = 'sales-platform.desktopTheme';

export function getStoredDesktopTheme(): DesktopTheme {
  try {
    const value = localStorage.getItem(STORAGE_KEY);
    if (value === 'light' || value === 'dark') {
      return value;
    }
  } catch {
    /* ignore */
  }
  return 'dark';
}

export function storeDesktopTheme(theme: DesktopTheme) {
  try {
    localStorage.setItem(STORAGE_KEY, theme);
  } catch {
    /* ignore */
  }
}

const THEME_COLOR: Record<DesktopTheme, string> = {
  dark: '#122820',
  light: '#fbf9f4',
};

export function applyDesktopTheme(theme: DesktopTheme) {
  document.documentElement.dataset.dtTheme = theme;
  const meta = document.querySelector<HTMLMetaElement>(
    'meta[name="theme-color"]:not([media])',
  );
  if (meta) {
    meta.content = THEME_COLOR[theme];
  }
}
