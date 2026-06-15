import { useMemo, useState } from 'react';
import {
  readOfflineStoreSettings,
  setOfflineAcquiringPercent,
  setOfflineManagerPercent,
  setOfflineSellerPercent,
  setOfflineStoreName,
} from '../offlineStoreSettings';

type SellerRow = {
  id: number;
  fullName: string;
  nickname: string;
  ratePercent: number;
};

export function StoreDirectorConsole({
  sellers,
  managerPercent,
  hasManager,
  onStoreNameChange,
  onAcquiringChange,
  onSellerPercentChange,
  onAddManager,
  onExitDirector,
}: {
  sellers: SellerRow[];
  managerPercent: number;
  hasManager: boolean;
  onStoreNameChange: (name: string) => void;
  onAcquiringChange: (percent: number) => void;
  onSellerPercentChange: (sellerId: number, percent: number) => Promise<void>;
  onAddManager: (fullName: string, nickname: string, percent: number) => Promise<void>;
  onExitDirector: () => void;
}) {
  const settings = useMemo(() => readOfflineStoreSettings(), []);
  const [storeNameDraft, setStoreNameDraft] = useState(settings.storeName);
  const [acquiringDraft, setAcquiringDraft] = useState(String(settings.acquiringPercent));
  const [percentDrafts, setPercentDrafts] = useState<Record<number, string>>({});
  const [managerFullName, setManagerFullName] = useState('');
  const [managerNickname, setManagerNickname] = useState('');
  const [managerPercentDraft, setManagerPercentDraft] = useState(String(managerPercent));
  const [status, setStatus] = useState('');
  const [busyId, setBusyId] = useState<number | null>(null);
  const [managerBusy, setManagerBusy] = useState(false);

  const saveStoreName = () => {
    const trimmed = storeNameDraft.trim();
    if (!trimmed) {
      return;
    }
    setOfflineStoreName(trimmed);
    onStoreNameChange(trimmed);
    setStatus('Название точки сохранено');
  };

  const saveAcquiring = () => {
    const num = Number(String(acquiringDraft).replace(',', '.'));
    if (!Number.isFinite(num)) {
      return;
    }
    setOfflineAcquiringPercent(num);
    onAcquiringChange(num);
    setStatus('Процент эквайринга сохранён');
  };

  const saveSellerPercent = async (seller: SellerRow) => {
    const raw = percentDrafts[seller.id] ?? String(seller.ratePercent);
    const num = Number(String(raw).replace(',', '.'));
    if (!Number.isFinite(num)) {
      return;
    }
    setBusyId(seller.id);
    setStatus('');
    try {
      setOfflineSellerPercent(seller.id, num);
      await onSellerPercentChange(seller.id, num);
      setStatus(`Процент ${seller.nickname} сохранён`);
    } finally {
      setBusyId(null);
    }
  };

  const saveManager = async () => {
    const fullName = managerFullName.trim();
    const nickname = managerNickname.trim();
    const num = Number(String(managerPercentDraft).replace(',', '.'));
    if (!fullName || !nickname || !Number.isFinite(num)) {
      return;
    }
    setManagerBusy(true);
    setStatus('');
    try {
      setOfflineManagerPercent(num);
      await onAddManager(fullName, nickname, num);
      setManagerFullName('');
      setManagerNickname('');
      setStatus(`Управляющий ${nickname} добавлен`);
    } finally {
      setManagerBusy(false);
    }
  };

  return (
    <section className="storeDirectorConsole" aria-label="Консоль директора">
      <div className="storeDirectorConsoleHeader">
        <p className="storeDirectorConsoleTitle">Консоль директора</p>
        <button type="button" className="ghost storeDirectorConsoleExit" onClick={onExitDirector}>
          Выйти
        </button>
      </div>
      {status ? <p className="notice storeDirectorConsoleStatus">{status}</p> : null}
      <div className="storeDirectorConsoleGrid">
        <label className="storeDirectorConsoleField">
          <span>Название точки</span>
          <div className="storeDirectorConsoleRow">
            <input
              value={storeNameDraft}
              onChange={(event) => setStoreNameDraft(event.target.value)}
              placeholder="Название для отчёта"
            />
            <button type="button" className="ghost" onClick={saveStoreName}>
              OK
            </button>
          </div>
        </label>
        <label className="storeDirectorConsoleField">
          <span>Эквайринг, %</span>
          <div className="storeDirectorConsoleRow">
            <input
              inputMode="decimal"
              value={acquiringDraft}
              onChange={(event) => setAcquiringDraft(event.target.value)}
            />
            <button type="button" className="ghost" onClick={saveAcquiring}>
              OK
            </button>
          </div>
        </label>
      </div>
      {sellers.length > 0 ? (
        <div className="storeDirectorConsoleSellers">
          <p className="storeDirectorConsoleSubtitle">Проценты продавцов</p>
          {sellers.map((seller) => (
            <label key={seller.id} className="storeDirectorConsoleSellerRow">
              <span title={`${seller.fullName} (${seller.nickname})`}>
                {seller.nickname}
              </span>
              <div className="storeDirectorConsoleRow">
                <input
                  inputMode="decimal"
                  value={percentDrafts[seller.id] ?? String(seller.ratePercent)}
                  onChange={(event) =>
                    setPercentDrafts((current) => ({
                      ...current,
                      [seller.id]: event.target.value,
                    }))
                  }
                />
                <button
                  type="button"
                  className="ghost"
                  disabled={busyId === seller.id}
                  onClick={() => void saveSellerPercent(seller)}
                >
                  {busyId === seller.id ? '…' : 'OK'}
                </button>
              </div>
            </label>
          ))}
        </div>
      ) : null}
      {hasManager ? (
        <p className="storeDirectorConsoleSubtitle">Управляющий уже добавлен на точку</p>
      ) : (
        <div className="storeDirectorConsoleSellers">
          <p className="storeDirectorConsoleSubtitle">Управляющий</p>
          <div className="storeDirectorConsoleGrid">
            <label className="storeDirectorConsoleField">
              <span>ФИО</span>
              <input
                value={managerFullName}
                onChange={(event) => setManagerFullName(event.target.value)}
                placeholder="ФИО управляющего"
              />
            </label>
            <label className="storeDirectorConsoleField">
              <span>Ник</span>
              <input
                value={managerNickname}
                onChange={(event) => setManagerNickname(event.target.value)}
                placeholder="Ник"
              />
            </label>
            <label className="storeDirectorConsoleField">
              <span>% от выручки точки</span>
              <div className="storeDirectorConsoleRow">
                <input
                  inputMode="decimal"
                  value={managerPercentDraft}
                  onChange={(event) => setManagerPercentDraft(event.target.value)}
                />
                <button
                  type="button"
                  className="ghost"
                  disabled={managerBusy}
                  onClick={() => void saveManager()}
                >
                  {managerBusy ? '…' : 'Добавить'}
                </button>
              </div>
            </label>
          </div>
        </div>
      )}
    </section>
  );
}
