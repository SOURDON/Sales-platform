import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { newClientId, runAdminMutation } from '../sync';
import {
  readDirectorDemoAccountsCache,
  writeDirectorDemoAccountsCache,
  type DirectorDemoAccountRow,
} from '../sync/equipmentCache';

function accountSecondaryLine(row: DirectorDemoAccountRow): string {
  if (row.role === 'ADMIN') {
    const store = row.storeName.trim();
    if (store) {
      return store;
    }
  }
  return roleLabel(row.role);
}

function roleLabel(role: string): string {
  switch (role) {
    case 'DIRECTOR':
      return 'Директор';
    case 'MANAGER':
      return 'Управляющий';
    case 'ACCOUNTANT':
      return 'Бухгалтер';
    case 'ADMIN':
      return 'Админ точки';
    default:
      return role;
  }
}

function SettingsIcon() {
  return (
    <svg viewBox="0 0 24 24" width="15" height="15" aria-hidden>
      <path
        fill="currentColor"
        d="M12 8.25a3.75 3.75 0 1 0 0 7.5 3.75 3.75 0 0 0 0-7.5Zm8.94 4.88-.96-.56.08-.99a8.2 8.2 0 0 0 0-1.66l-.08-.99.96-.56a.75.75 0 0 0 .34-1.02l-.9-1.56a.75.75 0 0 0-1.02-.28l-.96.56-1.01-.7a8.2 8.2 0 0 0-1.44-.83l-.17-1.1a.75.75 0 0 0-.74-.64h-1.8a.75.75 0 0 0-.74.64l-.17 1.1c-.5.2-.98.48-1.44.83l-1.01-.7-.96-.56a.75.75 0 0 0-1.02.28l-.9 1.56a.75.75 0 0 0 .34 1.02l.96.56-.08.99c-.05.55-.05 1.11 0 1.66l.08.99-.96.56a.75.75 0 0 0-.34 1.02l.9 1.56c.22.38.7.52 1.08.32l.96-.56 1.01.7c.46.35.94.63 1.44.83l.17 1.1c.08.38.4.64.74.64h1.8c.34 0 .66-.26.74-.64l.17-1.1c.5-.2.98-.48 1.44-.83l1.01.7.96.56c.38.2.86.06 1.08-.32l.9-1.56a.75.75 0 0 0-.34-1.02Z"
      />
    </svg>
  );
}

function ChevronIcon({ up }: { up: boolean }) {
  return (
    <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden className="desktopDirectorSwitcherChevron">
      <path fill="currentColor" d={up ? 'M7 14l5-5 5 5z' : 'M7 10l5 5 5-5z'} />
    </svg>
  );
}

export function DirectorAccountSwitcher({
  apiBaseUrl,
  directorToken,
  activeNickname,
  activeRole,
  isImpersonating,
  userId,
  onSwitchAccount,
  onReturnToDirector,
}: {
  apiBaseUrl: string;
  directorToken: string;
  activeNickname: string;
  activeRole: string;
  isImpersonating: boolean;
  userId?: number;
  onSwitchAccount: (nickname: string, password: string) => Promise<void>;
  onReturnToDirector: () => void;
}) {
  const panelId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const pwdRowRef = useRef<HTMLLIElement | null>(null);
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState<DirectorDemoAccountRow[]>(() => readDirectorDemoAccountsCache() ?? []);
  const [loading, setLoading] = useState(() => readDirectorDemoAccountsCache() === null);
  const [switchingNick, setSwitchingNick] = useState<string | null>(null);
  const [err, setErr] = useState('');
  const [hint, setHint] = useState('');
  const [pwdTarget, setPwdTarget] = useState<DirectorDemoAccountRow | null>(null);
  const [draftPwd, setDraftPwd] = useState('');
  const [pwdSaving, setPwdSaving] = useState(false);

  const switchableRows = rows.filter(
    (row) => row.role === 'ADMIN' || row.role === 'ACCOUNTANT' || row.role === 'MANAGER',
  );

  const activeRow = rows.find((row) => row.nickname === activeNickname);
  const triggerSubtitle = activeRow
    ? isImpersonating
      ? accountSecondaryLine(activeRow)
      : roleLabel(activeRole)
    : roleLabel(activeRole);

  const load = useCallback(async () => {
    setLoading(true);
    setErr('');
    try {
      const res = await fetch(`${apiBaseUrl}/director/demo-accounts`, {
        headers: { Authorization: `Bearer ${directorToken}` },
      });
      if (!res.ok) {
        throw new Error('http');
      }
      const data = (await res.json()) as DirectorDemoAccountRow[];
      setRows(data);
      writeDirectorDemoAccountsCache(data);
    } catch {
      if (rows.length === 0) {
        setErr('Не удалось загрузить учётные записи');
      }
    } finally {
      setLoading(false);
    }
  }, [apiBaseUrl, directorToken, rows.length]);

  useEffect(() => {
    if (open) {
      void load();
    }
  }, [open, load]);

  useEffect(() => {
    if (!pwdTarget) {
      return;
    }
    const id = window.requestAnimationFrame(() => {
      pwdRowRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    });
    return () => window.cancelAnimationFrame(id);
  }, [pwdTarget]);

  useEffect(() => {
    if (!open) {
      return;
    }
    const onDoc = (event: MouseEvent) => {
      const target = event.target as Node;
      if (rootRef.current?.contains(target)) {
        return;
      }
      setOpen(false);
      setPwdTarget(null);
      setDraftPwd('');
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpen(false);
        setPwdTarget(null);
        setDraftPwd('');
      }
    };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const closePanel = () => {
    setOpen(false);
    setPwdTarget(null);
    setDraftPwd('');
    setErr('');
    setHint('');
  };

  const handleSwitch = async (row: DirectorDemoAccountRow) => {
    if (row.nickname === activeNickname) {
      closePanel();
      return;
    }
    setSwitchingNick(row.nickname);
    setErr('');
    setHint('');
    try {
      await onSwitchAccount(row.nickname, row.password);
      closePanel();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Не удалось войти под учётной записью');
    } finally {
      setSwitchingNick(null);
    }
  };

  const savePassword = async () => {
    if (!pwdTarget) {
      return;
    }
    const pwd = draftPwd.trim();
    if (pwd.length < 8) {
      setErr('Новый пароль: минимум 8 символов');
      return;
    }
    setPwdSaving(true);
    setErr('');
    setHint('');
    try {
      const patchId = newClientId('dpwd');
      const createdAt = new Date().toISOString();
      const body = { patchId, nickname: pwdTarget.nickname, password: pwd, createdAt };
      const patch = async () => {
        const res = await fetch(
          `${apiBaseUrl}/director/demo-accounts/${encodeURIComponent(pwdTarget.nickname)}/password`,
          {
            method: 'PATCH',
            headers: {
              Authorization: `Bearer ${directorToken}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({ password: pwd }),
          },
        );
        if (!res.ok) {
          let msg = 'Не удалось сохранить пароль';
          try {
            const j = (await res.json()) as { message?: string | string[] };
            if (j.message) {
              msg = Array.isArray(j.message) ? j.message[0] : j.message;
            }
          } catch {
            /* ignore */
          }
          throw new Error(msg);
        }
      };
      if (userId !== undefined) {
        const mode = await runAdminMutation(userId, patchId, 'DIRECTOR_DEMO_PASSWORD', body, patch);
        if (mode === 'queued') {
          setDraftPwd('');
          setHint('Сохранено офлайн — отправится при подключении');
          return;
        }
      } else {
        await patch();
      }
      setDraftPwd('');
      setHint('Пароль обновлён');
      await load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Не удалось сохранить пароль');
    } finally {
      setPwdSaving(false);
    }
  };

  const copyPassword = async (password: string) => {
    setErr('');
    setHint('');
    try {
      await navigator.clipboard.writeText(password);
      setHint('Пароль скопирован');
    } catch {
      setErr('Не удалось скопировать');
    }
  };

  const renderAccountCard = (
    row: DirectorDemoAccountRow,
    options: {
      isActive?: boolean;
      isBusy?: boolean;
      onSelect: () => void;
      showSettings?: boolean;
      settingsActive?: boolean;
      onSettings?: () => void;
    },
  ) => {
    const letter = row.nickname.trim()[0]?.toUpperCase() ?? '?';
    return (
      <div
        className={`desktopSidebarUserCard desktopDirectorSwitcherCard${
          options.isActive ? ' desktopDirectorSwitcherCard--active' : ''
        }${options.isBusy ? ' desktopDirectorSwitcherCard--busy' : ''}`}
      >
        <button
          type="button"
          className="desktopDirectorSwitcherCardMain"
          disabled={Boolean(switchingNick)}
          onClick={options.onSelect}
        >
          <span className="desktopSidebarUserAvatar" aria-hidden>
            {letter}
          </span>
          <div className="desktopSidebarUserMeta">
            <span className="desktopSidebarUserName">{row.nickname}</span>
            <span
              className={`desktopSidebarUserRole${
                row.role === 'ADMIN' && row.storeName.trim()
                  ? ' desktopDirectorSwitcherStoreLine'
                  : ''
              }`}
              title={row.role === 'ADMIN' ? row.storeName : undefined}
            >
              {accountSecondaryLine(row)}
            </span>
            {row.role === 'ADMIN' && row.storeName.trim() ? (
              <span className="desktopDirectorSwitcherRoleHint">{roleLabel(row.role)}</span>
            ) : null}
          </div>
        </button>
        {options.showSettings ? (
          <button
            type="button"
            className={`ghost desktopDirectorSwitcherGear${
              options.settingsActive ? ' desktopDirectorSwitcherGear--active' : ''
            }`}
            aria-label={`Пароль и настройки: ${row.nickname}`}
            aria-expanded={options.settingsActive}
            disabled={Boolean(switchingNick)}
            onMouseDown={(event) => {
              event.preventDefault();
              event.stopPropagation();
            }}
            onPointerDown={(event) => {
              event.stopPropagation();
            }}
            onClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
              options.onSettings?.();
            }}
          >
            <SettingsIcon />
          </button>
        ) : null}
      </div>
    );
  };

  return (
    <div
      ref={rootRef}
      className={`desktopDirectorSwitcher${open ? ' desktopDirectorSwitcher--open' : ''}${
        isImpersonating ? ' desktopDirectorSwitcher--impersonating' : ''
      }`}
    >
      <div
        id={panelId}
        className="desktopDirectorSwitcherPanel"
        role="dialog"
        aria-label="Смена учётной записи"
        aria-hidden={!open}
      >
        <div className="desktopDirectorSwitcherPanelInner">
          {isImpersonating ? (
            <button
              type="button"
              className="desktopSidebarUserCard desktopDirectorSwitcherCard desktopDirectorSwitcherCard--back"
              onClick={() => {
                onReturnToDirector();
                closePanel();
              }}
            >
              <span className="desktopSidebarUserAvatar" aria-hidden>
                D
              </span>
              <div className="desktopSidebarUserMeta">
                <span className="desktopSidebarUserName">Директор</span>
                <span className="desktopSidebarUserRole">Вернуться</span>
              </div>
              <ChevronIcon up={false} />
            </button>
          ) : null}

          {err ? (
            <p className="error desktopDirectorSwitcherMsg" role="alert">
              {err}
            </p>
          ) : null}
          {hint ? (
            <p className="notice desktopDirectorSwitcherMsg" role="status">
              {hint}
            </p>
          ) : null}
          {loading ? <p className="muted desktopDirectorSwitcherMsg">Загрузка…</p> : null}

          <ul className="desktopDirectorSwitcherList" aria-label="Доступные учётные записи">
            {switchableRows.map((row) => {
              const isActive = row.nickname === activeNickname;
              const isBusy = switchingNick === row.nickname;
              const pwdOpen = pwdTarget?.nickname === row.nickname;
              return (
                <li
                  key={row.nickname}
                  ref={pwdOpen ? pwdRowRef : undefined}
                  className={pwdOpen ? 'desktopDirectorSwitcherListItem--pwdOpen' : undefined}
                >
                  {renderAccountCard(row, {
                    isActive,
                    isBusy,
                    showSettings: true,
                    settingsActive: pwdOpen,
                    onSelect: () => {
                      if (pwdOpen) {
                        return;
                      }
                      void handleSwitch(row);
                    },
                    onSettings: () => {
                      setPwdTarget((prev) => (prev?.nickname === row.nickname ? null : row));
                      setDraftPwd('');
                      setErr('');
                      setHint('');
                    },
                  })}
                  {pwdOpen && pwdTarget ? (
                    <div
                      className="desktopSidebarUserCard desktopDirectorSwitcherPwd desktopDirectorSwitcherPwd--inline"
                      onMouseDown={(event) => event.stopPropagation()}
                      onPointerDown={(event) => event.stopPropagation()}
                    >
                      <p className="desktopDirectorSwitcherPwdLabel">
                        Пароль · <strong>{pwdTarget.nickname}</strong>
                      </p>
                      <div className="desktopDirectorSwitcherPwdCurrent">
                        <code className="desktopDirectorSwitcherPwdValue">{pwdTarget.password}</code>
                        <button
                          type="button"
                          className="ghost desktopDirectorSwitcherPwdCopy"
                          onClick={() => void copyPassword(pwdTarget.password)}
                        >
                          Копировать
                        </button>
                      </div>
                      <input
                        type="password"
                        autoComplete="new-password"
                        className="desktopDirectorSwitcherPwdInput"
                        value={draftPwd}
                        onChange={(e) => setDraftPwd(e.target.value)}
                        placeholder="Новый пароль, мин. 10 символов"
                      />
                      <div className="desktopDirectorSwitcherPwdActions">
                        <button
                          type="button"
                          className="ghost desktopDirectorSwitcherPwdCancel"
                          onClick={() => {
                            setPwdTarget(null);
                            setDraftPwd('');
                          }}
                        >
                          Отмена
                        </button>
                        <button
                          type="button"
                          className="primaryAction desktopDirectorSwitcherPwdSave"
                          disabled={pwdSaving}
                          onClick={() => void savePassword()}
                        >
                          {pwdSaving ? 'Сохранение…' : 'Сохранить'}
                        </button>
                      </div>
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ul>

          {!loading && switchableRows.length === 0 ? (
            <p className="muted desktopDirectorSwitcherMsg">Нет доступных записей</p>
          ) : null}
        </div>
      </div>

      <button
        type="button"
        className="desktopSidebarUserCard desktopDirectorSwitcherTrigger"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => {
          if (open) {
            closePanel();
          } else {
            setOpen(true);
          }
        }}
      >
        <span className="desktopSidebarUserAvatar" aria-hidden>
          {activeNickname.trim()[0]?.toUpperCase() ?? '?'}
        </span>
        <div className="desktopSidebarUserMeta">
          <span className="desktopSidebarUserName">{activeNickname}</span>
          <span
            className={`desktopSidebarUserRole${
              isImpersonating && activeRow?.role === 'ADMIN' && activeRow.storeName.trim()
                ? ' desktopDirectorSwitcherStoreLine'
                : ''
            }`}
            title={isImpersonating && activeRow?.role === 'ADMIN' ? activeRow.storeName : undefined}
          >
            {isImpersonating ? `${triggerSubtitle} · просмотр` : triggerSubtitle}
          </span>
        </div>
        <ChevronIcon up={open} />
      </button>
    </div>
  );
}
