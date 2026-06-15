import { useMemo, useState } from 'react';
import {
  readOfflineStoreSettings,
  setOfflineAcquiringPercent,
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
  onStoreNameChange,
  onAcquiringChange,
  onSellerPercentChange,
}: {
  sellers: SellerRow[];
  onStoreNameChange: (name: string) => void;
  onAcquiringChange: (percent: number) => void;
  onSellerPercentChange: (sellerId: number, percent: number) => Promise<void>;
}) {
  const settings = useMemo(() => readOfflineStoreSettings(), []);
  const [storeNameDraft, setStoreNameDraft] = useState(settings.storeName);
  const [acquiringDraft, setAcquiringDraft] = useState(String(settings.acquiringPercent));
  const [percentDrafts, setPercentDrafts] = useState<Record<number, string>>({});
  const [status, setStatus] = useState('');
  const [busyId, setBusyId] = useState<number | null>(null);

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

  return (
    <section className="storeDirectorConsole" aria-label="Консоль директора">
      <p className="storeDirectorConsoleTitle">Консоль директора</p>
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
    </section>
  );
}
