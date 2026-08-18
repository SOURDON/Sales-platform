import { useEffect, useMemo, useState } from 'react';
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

type ManagerRow = {
  id: number;
  fullName: string;
  nickname: string;
};

type RetoucherRow = {
  id: number;
  fullName: string;
  nickname: string;
  ratePercent: number;
};

export function StoreDirectorConsole({
  sellers,
  manager,
  managerPercent,
  retoucher,
  onStoreNameChange,
  onAcquiringChange,
  onSellerPercentChange,
  onRenamePerson,
  onSaveManagerPercent,
  onSaveRetoucherPercent,
  onAddManager,
  onExportForDirector,
  onExitDirector,
}: {
  sellers: SellerRow[];
  manager: ManagerRow | null;
  managerPercent: number;
  retoucher: RetoucherRow | null;
  onStoreNameChange: (name: string) => void;
  onAcquiringChange: (percent: number) => void;
  onSellerPercentChange: (sellerId: number, percent: number) => Promise<void>;
  onRenamePerson: (id: number, fullName: string, nickname: string) => Promise<void>;
  onSaveManagerPercent: (percent: number) => Promise<void>;
  onSaveRetoucherPercent: (staffId: number, percent: number) => Promise<void>;
  onAddManager: (fullName: string, nickname: string, percent: number) => Promise<void>;
  onExportForDirector?: () => Promise<void>;
  onExitDirector: () => void;
}) {
  const settings = useMemo(() => readOfflineStoreSettings(), []);
  const [storeNameDraft, setStoreNameDraft] = useState(settings.storeName);
  const [acquiringDraft, setAcquiringDraft] = useState(String(settings.acquiringPercent));
  const [percentDrafts, setPercentDrafts] = useState<Record<number, string>>({});
  const [nameDrafts, setNameDrafts] = useState<Record<number, { fullName: string; nickname: string }>>(
    {},
  );
  const [managerFullName, setManagerFullName] = useState(manager?.fullName ?? '');
  const [managerNickname, setManagerNickname] = useState(manager?.nickname ?? '');
  const [managerPercentDraft, setManagerPercentDraft] = useState(String(managerPercent));
  const [retoucherName, setRetoucherName] = useState(retoucher?.fullName ?? '');
  const [retoucherNick, setRetoucherNick] = useState(retoucher?.nickname ?? '');
  const [retoucherPercentDraft, setRetoucherPercentDraft] = useState(
    String(retoucher?.ratePercent ?? 5),
  );
  const [status, setStatus] = useState('');
  const [busyId, setBusyId] = useState<number | null>(null);
  const [managerBusy, setManagerBusy] = useState(false);
  const [retoucherBusy, setRetoucherBusy] = useState(false);
  const [exportBusy, setExportBusy] = useState(false);

  useEffect(() => {
    setManagerFullName(manager?.fullName ?? '');
    setManagerNickname(manager?.nickname ?? '');
  }, [manager?.id, manager?.fullName, manager?.nickname]);

  useEffect(() => {
    setManagerPercentDraft(String(managerPercent));
  }, [managerPercent]);

  useEffect(() => {
    setRetoucherName(retoucher?.fullName ?? '');
    setRetoucherNick(retoucher?.nickname ?? '');
    setRetoucherPercentDraft(String(retoucher?.ratePercent ?? 5));
  }, [retoucher?.id, retoucher?.fullName, retoucher?.nickname, retoucher?.ratePercent]);

  const sellerNameDraft = (seller: SellerRow) =>
    nameDrafts[seller.id] ?? { fullName: seller.fullName, nickname: seller.nickname };

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

  const saveSeller = async (seller: SellerRow) => {
    const names = sellerNameDraft(seller);
    const fullName = names.fullName.trim();
    const nickname = names.nickname.trim();
    const raw = percentDrafts[seller.id] ?? String(seller.ratePercent);
    const num = Number(String(raw).replace(',', '.'));
    if (!fullName || !nickname || !Number.isFinite(num)) {
      return;
    }
    setBusyId(seller.id);
    setStatus('');
    try {
      if (fullName !== seller.fullName || nickname !== seller.nickname) {
        await onRenamePerson(seller.id, fullName, nickname);
      }
      setOfflineSellerPercent(seller.id, num);
      await onSellerPercentChange(seller.id, num);
      setStatus(`Сохранено: ${nickname}`);
    } finally {
      setBusyId(null);
    }
  };

  const saveExistingManager = async () => {
    if (!manager) {
      return;
    }
    const fullName = managerFullName.trim();
    const nickname = managerNickname.trim();
    const num = Number(String(managerPercentDraft).replace(',', '.'));
    if (!fullName || !nickname || !Number.isFinite(num)) {
      return;
    }
    setManagerBusy(true);
    setStatus('');
    try {
      if (fullName !== manager.fullName || nickname !== manager.nickname) {
        await onRenamePerson(manager.id, fullName, nickname);
      }
      setOfflineManagerPercent(num);
      await onSaveManagerPercent(num);
      setStatus(`Управляющий ${nickname} сохранён`);
    } finally {
      setManagerBusy(false);
    }
  };

  const saveRetoucher = async () => {
    if (!retoucher) {
      return;
    }
    const fullName = retoucherName.trim();
    const nickname = retoucherNick.trim();
    const num = Number(String(retoucherPercentDraft).replace(',', '.'));
    if (!fullName || !nickname || !Number.isFinite(num)) {
      return;
    }
    setRetoucherBusy(true);
    setStatus('');
    try {
      if (fullName !== retoucher.fullName || nickname !== retoucher.nickname) {
        await onRenamePerson(retoucher.id, fullName, nickname);
      }
      await onSaveRetoucherPercent(retoucher.id, num);
      setStatus(`Ретушёр ${nickname} сохранён`);
    } finally {
      setRetoucherBusy(false);
    }
  };

  const saveNewManager = async () => {
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
          <p className="storeDirectorConsoleSubtitle">Продавцы — имя и %</p>
          {sellers.map((seller) => {
            const names = sellerNameDraft(seller);
            return (
              <div key={seller.id} className="storeDirectorConsolePersonRow">
                <input
                  aria-label={`ФИО ${seller.nickname}`}
                  value={names.fullName}
                  onChange={(event) =>
                    setNameDrafts((current) => ({
                      ...current,
                      [seller.id]: { ...names, fullName: event.target.value },
                    }))
                  }
                  placeholder="ФИО"
                />
                <input
                  aria-label={`Ник ${seller.fullName}`}
                  value={names.nickname}
                  onChange={(event) =>
                    setNameDrafts((current) => ({
                      ...current,
                      [seller.id]: { ...names, nickname: event.target.value },
                    }))
                  }
                  placeholder="Ник"
                />
                <div className="storeDirectorConsoleRow">
                  <input
                    inputMode="decimal"
                    aria-label={`Процент ${seller.nickname}`}
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
                    onClick={() => void saveSeller(seller)}
                  >
                    {busyId === seller.id ? '…' : 'OK'}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      ) : null}
      <div className="storeDirectorConsoleSellers">
        <p className="storeDirectorConsoleSubtitle">Управляющий — имя и %</p>
        <div className="storeDirectorConsolePersonRow">
          <input
            value={managerFullName}
            onChange={(event) => setManagerFullName(event.target.value)}
            placeholder="ФИО управляющего"
            aria-label="ФИО управляющего"
          />
          <input
            value={managerNickname}
            onChange={(event) => setManagerNickname(event.target.value)}
            placeholder="Ник"
            aria-label="Ник управляющего"
          />
          <div className="storeDirectorConsoleRow">
            <input
              inputMode="decimal"
              value={managerPercentDraft}
              onChange={(event) => setManagerPercentDraft(event.target.value)}
              aria-label="Процент управляющего"
            />
            <button
              type="button"
              className="ghost"
              disabled={managerBusy}
              onClick={() => void (manager ? saveExistingManager() : saveNewManager())}
            >
              {managerBusy ? '…' : manager ? 'OK' : 'Добавить'}
            </button>
          </div>
        </div>
      </div>
      {retoucher ? (
        <div className="storeDirectorConsoleSellers">
          <p className="storeDirectorConsoleSubtitle">Ретушёр — имя и %</p>
          <div className="storeDirectorConsolePersonRow">
            <input
              value={retoucherName}
              onChange={(event) => setRetoucherName(event.target.value)}
              placeholder="ФИО ретушёра"
              aria-label="ФИО ретушёра"
            />
            <input
              value={retoucherNick}
              onChange={(event) => setRetoucherNick(event.target.value)}
              placeholder="Ник"
              aria-label="Ник ретушёра"
            />
            <div className="storeDirectorConsoleRow">
              <input
                inputMode="decimal"
                value={retoucherPercentDraft}
                onChange={(event) => setRetoucherPercentDraft(event.target.value)}
                aria-label="Процент ретушёра"
              />
              <button
                type="button"
                className="ghost"
                disabled={retoucherBusy}
                onClick={() => void saveRetoucher()}
              >
                {retoucherBusy ? '…' : 'OK'}
              </button>
            </div>
          </div>
        </div>
      ) : null}
      {onExportForDirector ? (
        <div className="storeDirectorConsoleExport">
          <button
            type="button"
            className="ghost"
            disabled={exportBusy}
            onClick={() => {
              setExportBusy(true);
              void onExportForDirector()
                .then(() => setStatus('Файл для директора сохранён'))
                .catch(() => setStatus('Не удалось сохранить файл'))
                .finally(() => setExportBusy(false));
            }}
          >
            {exportBusy ? 'Сохраняем…' : 'Выгрузить для директора'}
          </button>
        </div>
      ) : null}
    </section>
  );
}
