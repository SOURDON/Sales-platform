import './chatOfflineNotice.css';

export function ChatOfflineNotice() {
  return (
    <div className="chatOfflineNotice" role="status">
      Чат доступен только при подключении к интернету. Остальные разделы работают офлайн.
    </div>
  );
}
