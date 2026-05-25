import type { DesktopConnectionState } from './useDesktopConnection';
import './connectionBanner.css';

type Props = DesktopConnectionState & {
  variant?: 'bar' | 'pill';
};

export function ConnectionBanner({ online, syncing, variant = 'bar' }: Props) {
  if (online && !syncing) {
    if (variant === 'pill') {
      return (
        <span className="desktopConnPill desktopConnPill--ok" role="status" aria-live="polite">
          <span className="desktopConnPillDot" aria-hidden />
          На связи
        </span>
      );
    }
    return null;
  }

  const syncingNow = syncing;
  const message = syncingNow
    ? 'Синхронизация…'
    : 'Нет сети — данные сохраняются локально';

  if (variant === 'pill') {
    return (
      <span
        className={`desktopConnPill${syncingNow ? ' desktopConnPill--sync' : ' desktopConnPill--offline'}`}
        role="status"
        aria-live="polite"
      >
        <span className="desktopConnPillDot" aria-hidden />
        {message}
      </span>
    );
  }

  return (
    <div
      className={`desktopConnectionBanner${syncingNow ? ' desktopConnectionBanner--sync' : ' desktopConnectionBanner--offline'}`}
      role="status"
      aria-live="polite"
    >
      {message}
    </div>
  );
}
