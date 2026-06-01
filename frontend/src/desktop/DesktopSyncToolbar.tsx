import { useState } from 'react';
import './desktopSyncToolbar.css';

export function DesktopSyncToolbar({
  online,
  syncing,
  pendingCount,
  onSync,
}: {
  online: boolean;
  syncing: boolean;
  pendingCount: number;
  onSync: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);

  const handleClick = async () => {
    if (busy || syncing) {
      return;
    }
    setBusy(true);
    try {
      await onSync();
    } finally {
      setBusy(false);
    }
  };

  const label = busy || syncing ? '…' : 'Обновить';
  const ariaLabel = busy || syncing ? 'Обновление данных' : 'Обновить данные';
  const hint =
    pendingCount > 0
      ? `${pendingCount} в очереди на отправку`
      : online
        ? 'Загрузить с сервера и отправить очередь'
        : 'Отправка при появлении сети';

  return (
    <div className="desktopSyncToolbar">
      <button
        type="button"
        className="desktopSyncToolbarBtn"
        disabled={busy || syncing}
        title={hint}
        aria-label={ariaLabel}
        onClick={() => void handleClick()}
      >
        <svg viewBox="0 0 24 24" aria-hidden className="desktopSyncToolbarIcon">
          <path
            fill="currentColor"
            d="M12 4V1L8 5l4 4V6c3.31 0 6 2.69 6 6 0 1.01-.25 1.97-.7 2.8l1.46 1.46A7.93 7.93 0 0 0 20 12c0-4.42-3.58-8-8-8zm0 14c-3.31 0-6-2.69-6-6 0-1.01.25-1.97.7-2.8L5.24 9.74A7.93 7.93 0 0 0 4 12c0 4.42 3.58 8 8 8v3l4-4-4-4v3z"
          />
        </svg>
        {label}
      </button>
      {pendingCount > 0 ? (
        <span className="desktopSyncToolbarQueue" title={hint}>
          {pendingCount}
        </span>
      ) : null}
    </div>
  );
}
