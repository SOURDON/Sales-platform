import type { DesktopConnectionState } from './useDesktopConnection';
import './connectionBanner.css';

type Props = DesktopConnectionState & {
  variant?: 'bar' | 'pill';
};

export function ConnectionBanner({ online, syncing, variant = 'bar' }: Props) {
  if (online && !syncing) {
    if (variant === 'pill') {
      return (
        <span
          className="desktopConnPill desktopConnPill--ok"
          role="status"
          aria-live="polite"
          title="Связь с сервером установлена"
        >
          <span className="desktopConnPillDot" aria-hidden />
          На связи
        </span>
      );
    }
    return null;
  }

  const syncingNow = syncing;
  const shortLabel = syncingNow ? 'Синхр.' : 'Оффлайн';
  const fullMessage = syncingNow
    ? 'Синхронизация с сервером'
    : 'Нет связи — изменения сохраняются локально и отправятся при подключении';

  if (variant === 'pill') {
    return (
      <span
        className={`desktopConnPill${syncingNow ? ' desktopConnPill--sync' : ' desktopConnPill--offline'}`}
        role="status"
        aria-live="polite"
        title={fullMessage}
      >
        <span className="desktopConnPillDot" aria-hidden />
        {shortLabel}
      </span>
    );
  }

  return (
    <div
      className={`desktopConnectionBanner${syncingNow ? ' desktopConnectionBanner--sync' : ' desktopConnectionBanner--offline'}`}
      role="status"
      aria-live="polite"
    >
      {fullMessage}
    </div>
  );
}
