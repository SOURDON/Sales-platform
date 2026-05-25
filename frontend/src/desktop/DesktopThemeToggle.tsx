import type { DesktopTheme } from './desktopTheme';

export function DesktopThemeToggle({
  theme,
  onChange,
}: {
  theme: DesktopTheme;
  onChange: (theme: DesktopTheme) => void;
}) {
  return (
    <div className="desktopThemeToggle" role="group" aria-label="Тема оформления">
      <button
        type="button"
        className={`desktopThemeToggleBtn${theme === 'dark' ? ' desktopThemeToggleBtn--active' : ''}`}
        aria-pressed={theme === 'dark'}
        onClick={() => onChange('dark')}
      >
        Тёмная
      </button>
      <button
        type="button"
        className={`desktopThemeToggleBtn${theme === 'light' ? ' desktopThemeToggleBtn--active' : ''}`}
        aria-pressed={theme === 'light'}
        onClick={() => onChange('light')}
      >
        Светлая
      </button>
    </div>
  );
}
