import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import './App.css';

type LoginResponse = {
  token: string;
  user: {
    id: number;
    nickname: string;
    fullName: string;
    role: 'DIRECTOR' | 'ADMIN' | 'SELLER';
    storeName: string;
  };
};

type DashboardResponse = {
  role: 'DIRECTOR' | 'ADMIN' | 'SELLER';
  sellerDataManagedByAdmin: boolean;
  title: string;
  metrics: Array<{ label: string; value: string }>;
  stores: Array<{ name: string; revenue: string; netProfit: string }>;
  writeOffs?: Array<{
    id: string;
    createdAt: string;
    name: string;
    qty: number;
    reason: 'Брак' | 'Поломка';
  }>;
};

type SellerProfile = {
  id: number;
  fullName: string;
  nickname: string;
  storeName: string;
  ratePercent: number;
  salesAmount: number;
  checksCount: number;
  commissionAmount: number;
};

type CommissionRequest = {
  id: string;
  createdAt: string;
  sellerId: number;
  requestedByNickname: string;
  requestedPercent: number;
  previousPercent: number;
  status: 'PENDING' | 'APPROVED' | 'REJECTED';
  comment?: string;
};

type ProductItem = { name: string; price: number };

type AdminSale = {
  id: string;
  createdAt: string;
  sellerName: string;
  sellerId: number;
  totalAmount: number;
  units: number;
  items: Array<{ name: string; qty: number }>;
};

type ShiftInfo = {
  id: string;
  openedAt: string;
  closedAt?: string;
  openedBy: string;
  closedBy?: string;
  assignedSellerIds: number[];
  checksCount: number;
  itemsCount: number;
  status: 'OPEN' | 'CLOSED';
};

type CashDisciplineEvent = {
  id: string;
  createdAt: string;
  type: 'RETURN' | 'CANCEL' | 'ADJUSTMENT';
  comment: string;
  createdBy: string;
};

type StaffMember = {
  id: number;
  fullName: string;
  nickname: string;
  isActive: boolean;
  assignedShiftId?: string;
};

type GlobalEmployee = {
  id: number;
  fullName: string;
  nickname: string;
  homeStore: string;
  isActive: boolean;
};

type ThresholdNotification = {
  id: string;
  type: 'LOW_STOCK' | 'HIGH_DAMAGE_WRITE_OFF' | 'NO_SALES';
  message: string;
  createdAt: string;
};

type AuditLogItem = {
  id: string;
  createdAt: string;
  actor: string;
  action: string;
  details: string;
};

const API_BASE_URL = (() => {
  const fromEnv = import.meta.env.VITE_API_URL as string | undefined;
  if (fromEnv) {
    return fromEnv.replace(/\/$/, '');
  }
  if (typeof window !== 'undefined') {
    return `http://${window.location.hostname}:3000`;
  }
  return 'http://localhost:3000';
})();

function App() {
  const [nickname, setNickname] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [dashboardLoading, setDashboardLoading] = useState(false);
  const [error, setError] = useState('');
  const [session, setSession] = useState<LoginResponse | null>(null);
  const [dashboard, setDashboard] = useState<DashboardResponse | null>(null);
  const [sellers, setSellers] = useState<SellerProfile[]>([]);
  const [products, setProducts] = useState<ProductItem[]>([]);
  const [sales, setSales] = useState<AdminSale[]>([]);
  const [commissionRequests, setCommissionRequests] = useState<CommissionRequest[]>([]);
  const [shifts, setShifts] = useState<ShiftInfo[]>([]);
  const [cashEvents, setCashEvents] = useState<CashDisciplineEvent[]>([]);
  const [staff, setStaff] = useState<StaffMember[]>([]);
  const [globalEmployees, setGlobalEmployees] = useState<GlobalEmployee[]>([]);
  const [thresholds, setThresholds] = useState<ThresholdNotification[]>([]);
  const [auditLog, setAuditLog] = useState<AuditLogItem[]>([]);
  const [adminError, setAdminError] = useState('');

  const loadDashboard = async (token: string) => {
    setDashboardLoading(true);
    try {
      const response = await fetch(`${API_BASE_URL}/dashboard/overview`, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      if (!response.ok) {
        throw new Error('Dashboard error');
      }

      const data = (await response.json()) as DashboardResponse;
      setDashboard(data);
    } catch {
      setDashboard(null);
    } finally {
      setDashboardLoading(false);
    }
  };

  const loadSellers = async (token: string) => {
    try {
      const response = await fetch(`${API_BASE_URL}/admin/sellers`, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });
      if (!response.ok) {
        throw new Error('sellers error');
      }
      const data = (await response.json()) as SellerProfile[];
      setSellers(data);
      setAdminError('');
    } catch {
      setSellers([]);
      setAdminError('Не удалось загрузить продавцов.');
    }
  };

  const loadProducts = async (token: string) => {
    const response = await fetch(`${API_BASE_URL}/admin/products`, {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });
    if (!response.ok) {
      throw new Error('products error');
    }
    const data = (await response.json()) as ProductItem[];
    setProducts(data);
  };

  const loadSales = async (token: string) => {
    const response = await fetch(`${API_BASE_URL}/admin/sales`, {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });
    if (!response.ok) {
      throw new Error('sales error');
    }
    const data = (await response.json()) as AdminSale[];
    setSales(data);
  };

  const loadCommissionRequests = async (token: string) => {
    const response = await fetch(`${API_BASE_URL}/admin/commission-requests`, {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });
    if (!response.ok) {
      throw new Error('requests error');
    }
    const data = (await response.json()) as CommissionRequest[];
    setCommissionRequests(data);
  };

  const loadShifts = async (token: string) => {
    const response = await fetch(`${API_BASE_URL}/admin/shifts`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!response.ok) throw new Error('shifts error');
    setShifts((await response.json()) as ShiftInfo[]);
  };

  const loadCashEvents = async (token: string) => {
    const response = await fetch(`${API_BASE_URL}/admin/cash-discipline`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!response.ok) throw new Error('cash events error');
    setCashEvents((await response.json()) as CashDisciplineEvent[]);
  };

  const loadStaff = async (token: string) => {
    const response = await fetch(`${API_BASE_URL}/admin/staff`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!response.ok) throw new Error('staff error');
    setStaff((await response.json()) as StaffMember[]);
  };

  const loadGlobalEmployees = async (token: string) => {
    const response = await fetch(`${API_BASE_URL}/admin/employees/global`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!response.ok) throw new Error('global employees error');
    setGlobalEmployees((await response.json()) as GlobalEmployee[]);
  };

  const loadThresholds = async (token: string) => {
    const response = await fetch(`${API_BASE_URL}/admin/notifications/thresholds`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!response.ok) throw new Error('thresholds error');
    setThresholds((await response.json()) as ThresholdNotification[]);
  };

  const loadAuditLog = async (token: string) => {
    const response = await fetch(`${API_BASE_URL}/admin/audit-log`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!response.ok) throw new Error('audit log error');
    setAuditLog((await response.json()) as AuditLogItem[]);
  };


  const setDirectorPercent = async (token: string, sellerId: number, ratePercent: number) => {
    const response = await fetch(`${API_BASE_URL}/admin/sellers/percent`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ sellerId, ratePercent }),
    });
    if (!response.ok) {
      throw new Error('set percent error');
    }
    await loadSellers(token);
    await loadCommissionRequests(token);
  };

  const decideRequest = async (token: string, requestId: string, decision: 'APPROVE' | 'REJECT') => {
    const response = await fetch(
      `${API_BASE_URL}/director/commission-requests/${requestId}/decision`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ decision }),
      },
    );
    if (!response.ok) {
      throw new Error('decision error');
    }
    await loadSellers(token);
    await loadCommissionRequests(token);
  };

  const addSale = async (
    token: string,
    sellerId: number,
    items: Array<{ name: string; qty: number }>,
    totalAmount: number,
  ) => {
    const response = await fetch(`${API_BASE_URL}/admin/sales`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ sellerId, items, totalAmount }),
    });
    if (!response.ok) {
      throw new Error('add sale error');
    }
    await loadSellers(token);
    await loadSales(token);
  };

  const addWriteOff = async (
    token: string,
    name: string,
    qty: number,
    reason: 'Брак' | 'Поломка',
  ) => {
    const response = await fetch(`${API_BASE_URL}/admin/write-offs`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ name, qty, reason }),
    });
    if (!response.ok) {
      throw new Error('write-off error');
    }
    await loadDashboard(token);
  };

  const openShift = async (token: string, assignedSellerIds: number[]) => {
    const response = await fetch(`${API_BASE_URL}/admin/shifts/open`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ assignedSellerIds }),
    });
    if (!response.ok) throw new Error('open shift error');
    await loadShifts(token);
  };

  const closeShift = async (token: string) => {
    const response = await fetch(`${API_BASE_URL}/admin/shifts/close`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!response.ok) throw new Error('close shift error');
    await loadShifts(token);
  };

  const addCashEvent = async (
    token: string,
    type: 'RETURN' | 'CANCEL' | 'ADJUSTMENT',
    comment: string,
  ) => {
    const response = await fetch(`${API_BASE_URL}/admin/cash-discipline`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ type, comment }),
    });
    if (!response.ok) throw new Error('cash event error');
    await loadCashEvents(token);
  };

  const addStaffMember = async (token: string, fullName: string, nickname: string) => {
    const response = await fetch(`${API_BASE_URL}/admin/staff`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ fullName, nickname }),
    });
    if (!response.ok) throw new Error('add staff error');
    await loadStaff(token);
    await loadSellers(token);
    await loadGlobalEmployees(token);
  };

  const addStaffFromBase = async (token: string, employeeId: number) => {
    const response = await fetch(`${API_BASE_URL}/admin/staff/from-base`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ employeeId }),
    });
    if (!response.ok) throw new Error('add from base error');
    await loadStaff(token);
    await loadSellers(token);
  };

  const deactivateStaff = async (token: string, id: number) => {
    const response = await fetch(`${API_BASE_URL}/admin/staff/${id}/deactivate`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!response.ok) throw new Error('deactivate staff error');
    await loadStaff(token);
    await loadSellers(token);
    await loadGlobalEmployees(token);
  };

  const activateStaff = async (token: string, id: number) => {
    const response = await fetch(`${API_BASE_URL}/admin/staff/${id}/activate`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!response.ok) throw new Error('activate staff error');
    await loadStaff(token);
    await loadSellers(token);
    await loadGlobalEmployees(token);
  };

  const assignStaffToShift = async (token: string, id: number, shiftId: string) => {
    const response = await fetch(`${API_BASE_URL}/admin/staff/${id}/assign-shift`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ shiftId }),
    });
    if (!response.ok) throw new Error('assign shift error');
    await loadStaff(token);
    await loadShifts(token);
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError('');
    setLoading(true);

    try {
      const response = await fetch(`${API_BASE_URL}/auth/login`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ nickname, password }),
      });

      if (!response.ok) {
        throw new Error('Неверный логин или пароль');
      }

      const data = (await response.json()) as LoginResponse;
      setSession(data);
      setPassword('');
      await loadDashboard(data.token);
      if (data.user.role === 'ADMIN' || data.user.role === 'DIRECTOR') {
        setAdminError('');
        try {
          await loadSellers(data.token);
          await loadProducts(data.token);
          await loadSales(data.token);
          await loadCommissionRequests(data.token);
          await loadShifts(data.token);
          await loadCashEvents(data.token);
          await loadStaff(data.token);
          await loadGlobalEmployees(data.token);
          await loadThresholds(data.token);
          await loadAuditLog(data.token);
        } catch {
          setSellers([]);
          setProducts([]);
          setSales([]);
          setCommissionRequests([]);
          setShifts([]);
          setCashEvents([]);
          setStaff([]);
          setThresholds([]);
          setAuditLog([]);
          setAdminError('Не удалось загрузить панель администратора.');
        }
      } else {
        setSellers([]);
        setProducts([]);
        setSales([]);
        setCommissionRequests([]);
        setShifts([]);
        setCashEvents([]);
        setStaff([]);
        setThresholds([]);
        setAuditLog([]);
      }
    } catch {
      setSession(null);
      setDashboard(null);
      setSellers([]);
      setProducts([]);
      setSales([]);
      setCommissionRequests([]);
      setShifts([]);
      setCashEvents([]);
      setStaff([]);
      setGlobalEmployees([]);
      setThresholds([]);
      setAuditLog([]);
      setError('Не удалось войти. Проверьте данные и запущенный backend.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="app">
      <section className="card">
        <span className="badge">Геленджикская бухта</span>
        <h1>Фототографы</h1>
        <p className="subtitle">Авторизация в системе</p>

        {session ? (
          <div className="dashboard">
            <div className="success">
              <h2>Вход выполнен</h2>
              <p>
                <strong>Пользователь:</strong> {session.user.fullName}
              </p>
              <p>
                <strong>Ник:</strong> {session.user.nickname}
              </p>
              <p>
                <strong>Роль:</strong> {session.user.role}
              </p>
              <p>
                <strong>Точка:</strong> {session.user.storeName}
              </p>
            </div>

            {dashboardLoading ? (
              <p className="muted">Загружаем сводку...</p>
            ) : (
              dashboard && (
                <>
                  {dashboard.sellerDataManagedByAdmin && (
                    <p className="notice">
                      Данные продавца заполняет администратор точки.
                    </p>
                  )}
                  <h3>{dashboard.title}</h3>
                  <div className="metrics">
                    {dashboard.metrics
                      .filter(
                        (metric) =>
                          dashboard.role !== 'ADMIN' ||
                          !metric.label.toLowerCase().includes('чистая прибыль'),
                      )
                      .map((metric) => (
                      <article key={metric.label} className="metricCard">
                        <p>{metric.label}</p>
                        <strong>{metric.value}</strong>
                      </article>
                    ))}
                  </div>

                  <table>
                    <thead>
                      <tr>
                        <th>Магазин</th>
                        <th>Выручка</th>
                        {dashboard.role === 'DIRECTOR' && <th>Чистая прибыль</th>}
                      </tr>
                    </thead>
                    <tbody>
                      {dashboard.stores.map((store) => (
                        <tr key={store.name}>
                          <td>{store.name}</td>
                          <td>{store.revenue}</td>
                          {dashboard.role === 'DIRECTOR' && <td>{store.netProfit}</td>}
                        </tr>
                      ))}
                    </tbody>
                  </table>

                  {dashboard.role === 'ADMIN' && dashboard.writeOffs && (
                    <div className="writeOffsBlock">
                      <h3>Списания за день (товарный эквивалент)</h3>
                      {dashboard.writeOffs.length === 0 ? (
                        <p className="muted">Списаний за день нет</p>
                      ) : (
                        <ul>
                          {dashboard.writeOffs.map((item) => (
                            <li key={`${item.name}-${item.reason}`}>
                              {item.name} - {item.qty} шт. ({item.reason})
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  )}
                </>
              )
            )}

            <button
              type="button"
              onClick={() => {
                setSession(null);
                setDashboard(null);
                setSellers([]);
                setProducts([]);
                setSales([]);
                setCommissionRequests([]);
                setShifts([]);
                setCashEvents([]);
                setStaff([]);
                setThresholds([]);
                setAuditLog([]);
              }}
            >
              Выйти
            </button>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="form">
            <label>
              Никнейм
              <input
                value={nickname}
                onChange={(event) => setNickname(event.target.value)}
                placeholder="Введите никнейм"
                required
              />
            </label>

            <label>
              Пароль
              <input
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                placeholder="Введите пароль"
                required
              />
            </label>

            {error && <p className="error">{error}</p>}

            <button type="submit" disabled={loading}>
              {loading ? 'Входим...' : 'Войти'}
            </button>
          </form>
        )}

        <div className="help">
          <p>Тестовые пользователи:</p>
          <ul>
            <li>
              <code>director / 123456</code>
            </li>
            <li>
              <code>admin1 / 123456</code>
            </li>
            <li>
              <code>seller1 / 123456</code>
            </li>
          </ul>
        </div>

        {session &&
          (session.user.role === 'ADMIN' ||
            session.user.role === 'DIRECTOR' ||
            session.user.role === 'SELLER') && (
          <section className="adminPanel">
            <h3>Операционная панель</h3>
            {adminError && <p className="error">{adminError}</p>}
            <ShiftPanel
              token={session.token}
              sellers={sellers}
              shifts={shifts}
              onOpen={openShift}
              onClose={closeShift}
            />
            {session.user.role !== 'SELLER' && (
              <>
                <AddSaleForm
                  sellers={sellers}
                  products={products}
                  token={session.token}
                  onAddSale={addSale}
                />
                <WriteOffForm
                  products={products}
                  token={session.token}
                  onAddWriteOff={addWriteOff}
                />
                <CashDisciplinePanel
                  token={session.token}
                  events={cashEvents}
                  onAdd={addCashEvent}
                />
                <StaffPanel
                  token={session.token}
                  staff={staff}
                  globalEmployees={globalEmployees}
                  shifts={shifts}
                  onAdd={addStaffMember}
                  onAddFromBase={addStaffFromBase}
                  onDeactivate={deactivateStaff}
                  onActivate={activateStaff}
                  onAssignShift={assignStaffToShift}
                />
                <ThresholdPanel notifications={thresholds} />
                <AuditLogPanel items={auditLog} />
              </>
            )}
            {session.user.role === 'DIRECTOR' && (
              <DirectorRequestList
                requests={commissionRequests.filter((item) => item.status === 'PENDING')}
                token={session.token}
                onDecide={decideRequest}
              />
            )}
            {session.user.role !== 'SELLER' && (
              <>
                <div className="sellerList">
                  {sellers.map((seller) => (
                    <SellerRow
                      key={seller.id}
                      seller={seller}
                      role={session.user.role}
                      token={session.token}
                      onDirectorSetPercent={setDirectorPercent}
                    />
                  ))}
                </div>
                <div className="salesLog">
                  <h3>Недавние продажи</h3>
                  {sales.length === 0 ? (
                    <p className="muted">Пока нет внесенных продаж</p>
                  ) : (
                    <div className="salesList">
                      {sales.map((sale) => (
                        <article key={sale.id} className="saleItem">
                          <p className="saleHeader">
                            <strong>{new Date(sale.createdAt).toLocaleString('ru-RU')}</strong> –{' '}
                            {sale.sellerName}
                            <span className="saleTotal">
                              Итог: {sale.totalAmount.toLocaleString('ru-RU')} ₽
                            </span>
                          </p>
                          <ul>
                            {sale.items.map((line) => (
                              <li key={line.name}>
                                {line.name} × {line.qty}
                              </li>
                            ))}
                          </ul>
                        </article>
                      ))}
                    </div>
                  )}
                </div>
              </>
            )}
          </section>
        )}
      </section>
    </main>
  );
}

function AddSaleForm({
  sellers,
  products,
  token,
  onAddSale,
}: {
  sellers: SellerProfile[];
  products: ProductItem[];
  token: string;
  onAddSale: (
    token: string,
    sellerId: number,
    items: Array<{ name: string; qty: number }>,
    totalAmount: number,
  ) => Promise<void>;
}) {
  const [sellerId, setSellerId] = useState(sellers[0]?.id ?? 0);
  const [qty, setQty] = useState<Record<string, string>>({});
  const [totalAmount, setTotalAmount] = useState('');
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState('');

  const updateQty = (name: string, value: string) => {
    setQty((current) => ({ ...current, [name]: value }));
  };

  const submit = async () => {
    if (!sellerId) {
      setFormError('Выберите продавца');
      return;
    }
    setFormError('');
    setBusy(true);
    try {
      const items = products
        .map((item) => ({
          name: item.name,
          qty: Number(qty[item.name] || 0) || 0,
        }))
        .filter((line) => line.qty > 0);
      if (items.length === 0) {
        setFormError('Укажите хотя бы одну позицию');
        return;
      }
      const parsedTotal = Number(totalAmount);
      if (!parsedTotal || parsedTotal <= 0) {
        setFormError('Укажите итоговую сумму продажи');
        return;
      }
      await onAddSale(token, sellerId, items, parsedTotal);
      setQty({});
      setTotalAmount('');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="addSaleForm">
      <h4>Добавить продажу</h4>
      <p className="hint">Укажите товар и количество, затем вручную введите итоговую сумму продажи.</p>
      <div className="addSaleRow">
        <label>
          Продавец
          <select value={sellerId} onChange={(event) => setSellerId(Number(event.target.value))}>
            {sellers.map((seller) => (
              <option key={seller.id} value={seller.id}>
                {seller.fullName}
              </option>
            ))}
          </select>
        </label>
        <label>
          Итоговая сумма продажи (₽)
          <input
            inputMode="decimal"
            value={totalAmount}
            onChange={(event) => setTotalAmount(event.target.value)}
            placeholder="Например, 4250"
          />
        </label>
        <button type="button" onClick={submit} disabled={busy}>
          Сохранить продажу
        </button>
      </div>
      {formError && <p className="error">{formError}</p>}
      <div className="productGrid">
        {products.map((item) => (
          <label key={item.name} className="productCell">
            <div className="productName">{item.name}</div>
            <input
              inputMode="numeric"
              value={qty[item.name] ?? ''}
              onChange={(event) => updateQty(item.name, event.target.value)}
              placeholder="0"
            />
          </label>
        ))}
      </div>
    </div>
  );
}

function WriteOffForm({
  products,
  token,
  onAddWriteOff,
}: {
  products: ProductItem[];
  token: string;
  onAddWriteOff: (
    token: string,
    name: string,
    qty: number,
    reason: 'Брак' | 'Поломка',
  ) => Promise<void>;
}) {
  const [name, setName] = useState(products[0]?.name ?? '');
  const [qty, setQty] = useState('1');
  const [reason, setReason] = useState<'Брак' | 'Поломка'>('Брак');
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState('');

  const submit = async () => {
    if (!name) {
      setFormError('Выберите товар');
      return;
    }
    const parsedQty = Number(qty);
    if (!parsedQty || parsedQty <= 0) {
      setFormError('Введите корректное количество');
      return;
    }

    setFormError('');
    setBusy(true);
    try {
      await onAddWriteOff(token, name, parsedQty, reason);
      setQty('1');
    } catch {
      setFormError('Не удалось сохранить списание');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="writeOffForm">
      <h4>Списание товара (поштучно)</h4>
      <div className="writeOffRow">
        <label>
          Товар
          <select value={name} onChange={(event) => setName(event.target.value)}>
            {products.map((item) => (
              <option key={item.name} value={item.name}>
                {item.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Количество (шт.)
          <input
            inputMode="numeric"
            value={qty}
            onChange={(event) => setQty(event.target.value)}
          />
        </label>
        <label>
          Причина
          <select
            value={reason}
            onChange={(event) => setReason(event.target.value as 'Брак' | 'Поломка')}
          >
            <option value="Брак">Брак</option>
            <option value="Поломка">Поломка</option>
          </select>
        </label>
        <button type="button" onClick={submit} disabled={busy}>
          Списать
        </button>
      </div>
      {formError && <p className="error">{formError}</p>}
    </div>
  );
}

function ShiftPanel({
  token,
  sellers,
  shifts,
  onOpen,
  onClose,
}: {
  token: string;
  sellers: SellerProfile[];
  shifts: ShiftInfo[];
  onOpen: (token: string, assignedSellerIds: number[]) => Promise<void>;
  onClose: (token: string) => Promise<void>;
}) {
  const [selectedSellerIds, setSelectedSellerIds] = useState<number[]>([]);
  const [busy, setBusy] = useState(false);
  const openShift = shifts.find((item) => item.status === 'OPEN');

  const toggleSeller = (id: number) => {
    setSelectedSellerIds((current) =>
      current.includes(id) ? current.filter((item) => item !== id) : [...current, id],
    );
  };

  return (
    <div className="opsCard">
      <h4>Открытие/закрытие смены</h4>
      <div className="inlineGrid">
        {sellers.map((seller) => (
          <label key={seller.id}>
            <input
              type="checkbox"
              checked={selectedSellerIds.includes(seller.id)}
              onChange={() => toggleSeller(seller.id)}
            />
            {seller.fullName}
          </label>
        ))}
      </div>
      <div className="inlineActions">
        <button
          type="button"
          disabled={busy || !!openShift}
          onClick={async () => {
            setBusy(true);
            try {
              await onOpen(token, selectedSellerIds);
            } finally {
              setBusy(false);
            }
          }}
        >
          Открыть смену
        </button>
        <button
          type="button"
          className="ghost"
          disabled={busy || !openShift}
          onClick={async () => {
            setBusy(true);
            try {
              await onClose(token);
            } finally {
              setBusy(false);
            }
          }}
        >
          Закрыть смену
        </button>
      </div>
      <div className="opsList">
        {shifts.map((shift) => (
          <p key={shift.id}>
            {shift.status} | Открыл: {shift.openedBy} | Закрыл: {shift.closedBy ?? '-'} | Чеки:{' '}
            {shift.checksCount} | Товары: {shift.itemsCount}
          </p>
        ))}
      </div>
    </div>
  );
}

function CashDisciplinePanel({
  token,
  events,
  onAdd,
}: {
  token: string;
  events: CashDisciplineEvent[];
  onAdd: (
    token: string,
    type: 'RETURN' | 'CANCEL' | 'ADJUSTMENT',
    comment: string,
  ) => Promise<void>;
}) {
  const [type, setType] = useState<'RETURN' | 'CANCEL' | 'ADJUSTMENT'>('RETURN');
  const [comment, setComment] = useState('');
  return (
    <div className="opsCard">
      <h4>Кассовая дисциплина</h4>
      <div className="inlineGrid">
        <label>
          Тип
          <select
            value={type}
            onChange={(event) =>
              setType(event.target.value as 'RETURN' | 'CANCEL' | 'ADJUSTMENT')
            }
          >
            <option value="RETURN">Возврат</option>
            <option value="CANCEL">Отмена</option>
            <option value="ADJUSTMENT">Корректировка</option>
          </select>
        </label>
        <label>
          Комментарий (обязательно)
          <input value={comment} onChange={(event) => setComment(event.target.value)} />
        </label>
        <button
          type="button"
          onClick={async () => {
            await onAdd(token, type, comment);
            setComment('');
          }}
        >
          Добавить
        </button>
      </div>
      <div className="opsList">
        {events.map((event) => (
          <p key={event.id}>
            {new Date(event.createdAt).toLocaleString('ru-RU')} | {event.type} | {event.comment} |{' '}
            {event.createdBy}
          </p>
        ))}
      </div>
    </div>
  );
}

function StaffPanel({
  token,
  staff,
  globalEmployees,
  shifts,
  onAdd,
  onAddFromBase,
  onDeactivate,
  onActivate,
  onAssignShift,
}: {
  token: string;
  staff: StaffMember[];
  globalEmployees: GlobalEmployee[];
  shifts: ShiftInfo[];
  onAdd: (token: string, fullName: string, nickname: string) => Promise<void>;
  onAddFromBase: (token: string, employeeId: number) => Promise<void>;
  onDeactivate: (token: string, id: number) => Promise<void>;
  onActivate: (token: string, id: number) => Promise<void>;
  onAssignShift: (token: string, id: number, shiftId: string) => Promise<void>;
}) {
  const [fullName, setFullName] = useState('');
  const [nickname, setNickname] = useState('');
  const [selectedEmployeeId, setSelectedEmployeeId] = useState<number>(
    globalEmployees[0]?.id ?? 0,
  );
  useEffect(() => {
    if (!selectedEmployeeId && globalEmployees.length > 0) {
      setSelectedEmployeeId(globalEmployees[0].id);
    }
  }, [globalEmployees, selectedEmployeeId]);
  const staffIds = new Set(staff.map((member) => member.id));
  const selectedEmployee = globalEmployees.find((employee) => employee.id === selectedEmployeeId);
  const alreadyInStore = selectedEmployee ? staffIds.has(selectedEmployee.id) : false;
  const openShift = shifts.find((item) => item.status === 'OPEN');
  return (
    <div className="opsCard">
      <h4>Управление персоналом</h4>
      <div className="inlineGrid">
        <label>
          ФИО
          <input value={fullName} onChange={(event) => setFullName(event.target.value)} />
        </label>
        <label>
          Ник
          <input value={nickname} onChange={(event) => setNickname(event.target.value)} />
        </label>
        <button
          type="button"
          onClick={async () => {
            await onAdd(token, fullName, nickname);
            setFullName('');
            setNickname('');
          }}
        >
          Добавить сотрудника
        </button>
      </div>
      <div className="inlineGrid inlineGridStaffBase">
        <label>
          Сотрудник из общей базы
          <select
            value={selectedEmployeeId}
            onChange={(event) => setSelectedEmployeeId(Number(event.target.value))}
          >
            {globalEmployees.map((employee) => (
              <option key={employee.id} value={employee.id}>
                {employee.fullName} ({employee.nickname}) - {employee.homeStore}
                {staffIds.has(employee.id) ? ' [уже в этой точке]' : ''}
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          disabled={!selectedEmployeeId || alreadyInStore}
          onClick={() => selectedEmployeeId && onAddFromBase(token, selectedEmployeeId)}
        >
          Добавить из общей базы
        </button>
        <p className="inlineStatus">{alreadyInStore ? 'Уже добавлен в эту точку' : ''}</p>
      </div>
      <div className="opsList">
        {staff.map((member) => (
          <StaffRow
            key={member.id}
            token={token}
            member={member}
            openShiftId={openShift?.id}
            onDeactivate={onDeactivate}
            onActivate={onActivate}
            onAssignShift={onAssignShift}
          />
        ))}
      </div>
    </div>
  );
}

function StaffRow({
  token,
  member,
  openShiftId,
  onDeactivate,
  onActivate,
  onAssignShift,
}: {
  token: string;
  member: StaffMember;
  openShiftId?: string;
  onDeactivate: (token: string, id: number) => Promise<void>;
  onActivate: (token: string, id: number) => Promise<void>;
  onAssignShift: (token: string, id: number, shiftId: string) => Promise<void>;
}) {
  return (
    <div className="staffRow">
      <p>
        {member.fullName} ({member.nickname}) | {member.isActive ? 'Активен' : 'Отключен'} | Смена:{' '}
        {member.assignedShiftId ?? '-'}
      </p>
      <div className="inlineActions">
        <button
          type="button"
          className="ghost"
          disabled={!openShiftId}
          onClick={() => openShiftId && onAssignShift(token, member.id, openShiftId)}
        >
          Назначить на открытую смену
        </button>
        {member.isActive ? (
          <button type="button" className="ghost" onClick={() => onDeactivate(token, member.id)}>
            Деактивировать
          </button>
        ) : (
          <button type="button" className="ghost" onClick={() => onActivate(token, member.id)}>
            Активировать
          </button>
        )}
      </div>
    </div>
  );
}

function ThresholdPanel({ notifications }: { notifications: ThresholdNotification[] }) {
  return (
    <div className="opsCard">
      <h4>Пороговые уведомления</h4>
      <div className="opsList">
        {notifications.length === 0 ? (
          <p>Нет активных уведомлений</p>
        ) : (
          notifications.map((item) => (
            <p key={item.id}>
              [{item.type}] {item.message}
            </p>
          ))
        )}
      </div>
    </div>
  );
}

function AuditLogPanel({ items }: { items: AuditLogItem[] }) {
  return (
    <div className="opsCard">
      <h4>История действий (audit log)</h4>
      <div className="opsList">
        {items.map((item) => (
          <p key={item.id}>
            {new Date(item.createdAt).toLocaleString('ru-RU')} | {item.actor} | {item.action} | {item.details}
          </p>
        ))}
      </div>
    </div>
  );
}

function DirectorRequestList({
  requests,
  token,
  onDecide,
}: {
  requests: CommissionRequest[];
  token: string;
  onDecide: (token: string, id: string, decision: 'APPROVE' | 'REJECT') => Promise<void>;
}) {
  if (requests.length === 0) {
    return null;
  }

  return (
    <div className="directorQueue">
      <h4>Заявки на смену процента</h4>
      {requests.map((request) => (
        <article key={request.id} className="requestCard">
          <p>
            <strong>{request.requestedByNickname}</strong> просит для продавца #{request.sellerId}: с{' '}
            {request.previousPercent}% на {request.requestedPercent}%
          </p>
          {request.comment && <p className="hint">Комментарий: {request.comment}</p>}
          <div className="requestActions">
            <button type="button" onClick={() => onDecide(token, request.id, 'APPROVE')}>
              Согласовать
            </button>
            <button type="button" className="ghost" onClick={() => onDecide(token, request.id, 'REJECT')}>
              Отклонить
            </button>
          </div>
        </article>
      ))}
    </div>
  );
}

function SellerRow({
  seller,
  role,
  token,
  onDirectorSetPercent,
}: {
  seller: SellerProfile;
  role: 'DIRECTOR' | 'ADMIN' | 'SELLER';
  token: string;
  onDirectorSetPercent: (token: string, sellerId: number, ratePercent: number) => Promise<void>;
}) {
  const [newPercent, setNewPercent] = useState(String(seller.ratePercent));
  const [busy, setBusy] = useState(false);

  const applyDirector = async () => {
    setBusy(true);
    try {
      await onDirectorSetPercent(token, seller.id, Number(newPercent) || 0);
    } finally {
      setBusy(false);
    }
  };

  return (
    <article className="sellerCard">
      <p>
        <strong>{seller.fullName}</strong> ({seller.nickname})
      </p>
      <p>
        Точка: {seller.storeName} | Продажи: {seller.salesAmount.toLocaleString('ru-RU')} ₽ | Чеки:{' '}
        {seller.checksCount} | Начислено: {seller.commissionAmount.toLocaleString('ru-RU')} ₽
      </p>
      <p className="percentLine">
        Текущий процент: <strong>{seller.ratePercent}%</strong>
      </p>

      {role === 'DIRECTOR' && (
        <div className="directorPercent">
          <label>
            Новый процент (директор)
            <input value={newPercent} onChange={(event) => setNewPercent(event.target.value)} />
          </label>
          <button type="button" onClick={applyDirector} disabled={busy}>
            Применить
          </button>
        </div>
      )}

      {role === 'ADMIN' && (
        <div className="adminPercent">
          <p className="hint">Изменять процент может только директор.</p>
        </div>
      )}
    </article>
  );
}

export default App;
