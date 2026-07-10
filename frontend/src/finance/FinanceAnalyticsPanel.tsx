import { useEffect, useMemo, useRef, useState } from 'react';
import { ALL_DEMO_STORE_NAMES } from '../inventory/normalizeInventoryOverview';
import {
  computeFinanceAnalytics,
  financeThroughputJuneStartKey,
  formatAnalyticsDayKey,
  readStoreRentSettings,
  writeStoreRentSettings,
  type StoreRentSettings,
} from './financeAnalytics';
import './financeAnalyticsPanel.css';

type SaleRow = {
  sellerId: number;
  totalAmount: number;
  createdAt: string;
  paymentType?: 'CASH' | 'NON_CASH' | 'TRANSFER';
  pendingSync?: boolean;
};

type SellerRow = { id: number; storeName: string };
type ExpenseRow = {
  title?: string;
  amount: number;
  comment?: string;
  createdAt: string;
  workDay?: string;
};
type IncomeRow = {
  amount: number;
  comment?: string;
  createdAt: string;
  workDay?: string;
  accountId?: string;
};
type DashboardStoreRow = { name: string; revenue: string; salaries: string; cash?: string };

type AnalyticsTab = 'overview' | 'net' | 'netOverhead' | 'payments' | 'payroll';

const TAB_LABELS: Record<AnalyticsTab, string> = {
  overview: 'Сводка',
  net: 'Чистая',
  netOverhead: '−10%',
  payments: 'Оплата',
  payroll: 'ЗП',
};

function fmtRub(value: number): string {
  return `${Math.round(value).toLocaleString('ru-RU')} ₽`;
}

function monthTitle(year: number, month: number): string {
  return new Intl.DateTimeFormat('ru-RU', { month: 'long', year: 'numeric' }).format(
    new Date(year, month, 1),
  );
}

function buildMonthCells(year: number, month: number): Array<{ dayKey: string | null }> {
  const first = new Date(year, month, 1);
  const startPad = (first.getDay() + 6) % 7;
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const cells: Array<{ dayKey: string | null }> = [];
  for (let i = 0; i < startPad; i += 1) {
    cells.push({ dayKey: null });
  }
  for (let day = 1; day <= daysInMonth; day += 1) {
    const dayKey = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    cells.push({ dayKey });
  }
  return cells;
}

function AnalyticsRangeCalendar({
  from,
  to,
  maxDay,
  onChange,
}: {
  from: string;
  to: string;
  maxDay: string;
  onChange: (nextFrom: string, nextTo: string) => void;
}) {
  const initial = from ? new Date(`${from}T12:00:00`) : new Date();
  const [viewYear, setViewYear] = useState(initial.getFullYear());
  const [viewMonth, setViewMonth] = useState(initial.getMonth());
  const [pickStart, setPickStart] = useState(from);

  const cells = useMemo(() => buildMonthCells(viewYear, viewMonth), [viewYear, viewMonth]);

  const pickDay = (dayKey: string) => {
    if (dayKey > maxDay) {
      return;
    }
    if (!pickStart || pickStart > dayKey) {
      setPickStart(dayKey);
      onChange(dayKey, dayKey);
      return;
    }
    onChange(pickStart, dayKey > pickStart ? dayKey : pickStart);
  };

  return (
    <div className="financeAnalyticsCalendar">
      <div className="financeAnalyticsCalendarNav">
        <button
          type="button"
          className="ghost financeAnalyticsCalendarNavBtn"
          aria-label="Предыдущий месяц"
          onClick={() => {
            const d = new Date(viewYear, viewMonth - 1, 1);
            setViewYear(d.getFullYear());
            setViewMonth(d.getMonth());
          }}
        >
          ‹
        </button>
        <span>{monthTitle(viewYear, viewMonth)}</span>
        <button
          type="button"
          className="ghost financeAnalyticsCalendarNavBtn"
          aria-label="Следующий месяц"
          onClick={() => {
            const d = new Date(viewYear, viewMonth + 1, 1);
            setViewYear(d.getFullYear());
            setViewMonth(d.getMonth());
          }}
        >
          ›
        </button>
      </div>
      <div className="financeAnalyticsCalendarWeekdays" aria-hidden>
        {['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'].map((label) => (
          <span key={label}>{label}</span>
        ))}
      </div>
      <div className="financeAnalyticsCalendarGrid">
        {cells.map((cell, index) => {
          if (!cell.dayKey) {
            return <span key={`e-${index}`} className="financeAnalyticsCalendarDay financeAnalyticsCalendarDay--empty" />;
          }
          const inRange = cell.dayKey >= from && cell.dayKey <= to;
          const isEdge = cell.dayKey === from || cell.dayKey === to;
          return (
            <button
              key={cell.dayKey}
              type="button"
              disabled={cell.dayKey > maxDay}
              className={`financeAnalyticsCalendarDay${inRange ? ' financeAnalyticsCalendarDay--inRange' : ''}${
                isEdge ? ' financeAnalyticsCalendarDay--edge' : ''
              }`}
              onClick={() => pickDay(cell.dayKey!)}
            >
              {Number(cell.dayKey.slice(8, 10))}
            </button>
          );
        })}
      </div>
      <p className="financeAnalyticsCalendarHint">
        {formatAnalyticsDayKey(from)} — {formatAnalyticsDayKey(to)}
      </p>
    </div>
  );
}

function BarChart({ label, value, max }: { label: string; value: number; max: number }) {
  const width = max > 0 ? Math.max(6, Math.round((Math.abs(value) / max) * 100)) : 0;
  return (
    <div className="financeAnalyticsBarRow">
      <span className="financeAnalyticsBarLabel" title={label}>
        {label}
      </span>
      <div className="financeAnalyticsBarTrack" aria-hidden>
        <div className="financeAnalyticsBarFill" style={{ width: `${width}%` }}>
          <span className="financeAnalyticsBarFillGlow" />
        </div>
      </div>
      <strong className="financeAnalyticsBarValue">{fmtRub(value)}</strong>
    </div>
  );
}

export function FinanceAnalyticsPanel({
  sales,
  sellers,
  expenses,
  incomes,
  dashboardStores,
  sensitiveVisible,
}: {
  sales: SaleRow[];
  sellers: SellerRow[];
  expenses: ExpenseRow[];
  incomes: IncomeRow[];
  dashboardStores?: DashboardStoreRow[];
  sensitiveVisible: boolean;
}) {
  const todayKey = useMemo(
    () =>
      new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Europe/Moscow',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      }).format(new Date()),
    [],
  );
  const [periodFrom, setPeriodFrom] = useState(financeThroughputJuneStartKey);
  const [periodTo, setPeriodTo] = useState(todayKey);
  const [storeFilter, setStoreFilter] = useState('__all__');
  const [tab, setTab] = useState<AnalyticsTab>('overview');
  const [rentSettings, setRentSettings] = useState<StoreRentSettings>(() => readStoreRentSettings());
  const [periodOpen, setPeriodOpen] = useState(false);
  const periodRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    writeStoreRentSettings(rentSettings);
  }, [rentSettings]);

  useEffect(() => {
    if (!periodOpen) {
      return;
    }
    const onPointerDown = (event: PointerEvent) => {
      if (!periodRef.current?.contains(event.target as Node)) {
        setPeriodOpen(false);
      }
    };
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [periodOpen]);

  const summary = useMemo(
    () =>
      computeFinanceAnalytics({
        period: { from: periodFrom, to: periodTo },
        storeFilter,
        sales,
        sellers,
        expenses,
        incomes,
        dashboardStores,
        rentSettings,
      }),
    [periodFrom, periodTo, storeFilter, sales, sellers, expenses, incomes, dashboardStores, rentSettings],
  );

  const chartRows =
    storeFilter === '__all__'
      ? summary.stores.filter((row) => row.revenue > 0 || row.payroll > 0 || row.rentTotal > 0)
      : summary.stores;

  const chartMax = useMemo(() => {
    if (tab === 'payments') {
      const breakdown = summary.totals.paymentBreakdown;
      return Math.max(1, breakdown.cash, breakdown.nonCash, breakdown.transfer);
    }
    return Math.max(
      1,
      ...chartRows.map((row) =>
        tab === 'netOverhead'
          ? row.netAfterOverhead
          : tab === 'net'
            ? row.netProfit
            : tab === 'payroll'
              ? row.payroll
              : row.revenue,
      ),
    );
  }, [tab, chartRows, summary.totals.paymentBreakdown]);

  const displayValue = (value: number) => (sensitiveVisible ? fmtRub(value) : '••••••');
  const chartTitle =
    tab === 'netOverhead'
      ? 'Чистая − 10% − аренда'
      : tab === 'net'
        ? 'Чистая прибыль'
        : tab === 'payroll'
          ? 'Зарплаты'
          : tab === 'payments'
            ? 'Проходка'
            : 'Выручка';

  return (
    <div className="financeAnalyticsPanel">
      <div className="financeAnalyticsToolbar">
        <label className="financeAnalyticsStoreSelect">
          <span className="sr-only">Точка</span>
          <select value={storeFilter} onChange={(e) => setStoreFilter(e.target.value)}>
            <option value="__all__">Все точки</option>
            {ALL_DEMO_STORE_NAMES.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>
        </label>

        <div className="financeAnalyticsPeriodSlot" ref={periodRef}>
          <button
            type="button"
            className={`financeAnalyticsPeriodBtn${periodOpen ? ' financeAnalyticsPeriodBtn--open' : ''}`}
            aria-expanded={periodOpen}
            onClick={() => setPeriodOpen((open) => !open)}
          >
            {formatAnalyticsDayKey(periodFrom)} — {formatAnalyticsDayKey(periodTo)}
          </button>
          {periodOpen ? (
            <div className="financeAnalyticsPeriodPop">
              <AnalyticsRangeCalendar
                from={periodFrom}
                to={periodTo}
                maxDay={todayKey}
                onChange={(from, to) => {
                  setPeriodFrom(from);
                  setPeriodTo(to <= todayKey ? to : todayKey);
                }}
              />
            </div>
          ) : null}
        </div>

        <div className="financeAnalyticsTabs" role="tablist">
          {(Object.keys(TAB_LABELS) as AnalyticsTab[]).map((id) => (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={tab === id}
              className={`financeAnalyticsTab${tab === id ? ' financeAnalyticsTab--active' : ''}`}
              onClick={() => setTab(id)}
            >
              {TAB_LABELS[id]}
            </button>
          ))}
        </div>
      </div>

      <div className="financeAnalyticsKpiRow">
        <div className="financeAnalyticsKpi">
          <span>Выручка</span>
          <strong>{displayValue(summary.totals.revenue)}</strong>
        </div>
        <div className="financeAnalyticsKpi">
          <span>ЗП</span>
          <strong>{displayValue(summary.totals.payroll)}</strong>
        </div>
        <div className="financeAnalyticsKpi">
          <span>Чистая</span>
          <strong>{displayValue(summary.totals.netProfit)}</strong>
        </div>
        <div className="financeAnalyticsKpi financeAnalyticsKpi--accent">
          <span>−10% − аренда</span>
          <strong>{displayValue(summary.totals.netAfterOverhead)}</strong>
        </div>
      </div>

      {tab !== 'payments' ? (
        <section className="financeAnalyticsChart">
          <h4>{chartTitle}</h4>
          {chartRows.length === 0 ? (
            <p className="financeAnalyticsEmpty">Нет данных за период</p>
          ) : (
            chartRows.map((row) => {
              const value =
                tab === 'netOverhead'
                  ? row.netAfterOverhead
                  : tab === 'net'
                    ? row.netProfit
                    : tab === 'payroll'
                      ? row.payroll
                      : row.revenue;
              return <BarChart key={row.storeName} label={row.storeName} value={value} max={chartMax} />;
            })
          )}
        </section>
      ) : (
        <section className="financeAnalyticsChart">
          <h4>Проходка по оплате</h4>
          <BarChart label="Наличные" value={summary.totals.paymentBreakdown.cash} max={chartMax} />
          <BarChart label="Безнал" value={summary.totals.paymentBreakdown.nonCash} max={chartMax} />
          <BarChart label="Перевод" value={summary.totals.paymentBreakdown.transfer} max={chartMax} />
        </section>
      )}

      <section className="financeAnalyticsTableWrap">
        <table className="financeAnalyticsTable">
          <thead>
            <tr>
              <th>Точка</th>
              <th>Выручка</th>
              <th>ЗП</th>
              <th>Чистая</th>
              <th>−10%</th>
              <th>Аренда</th>
              <th>Итого</th>
              <th>Окупаемость</th>
            </tr>
          </thead>
          <tbody>
            {summary.stores.map((row) => (
              <tr key={row.storeName}>
                <td className="financeAnalyticsTdStore">{row.storeName}</td>
                <td>{displayValue(row.revenue)}</td>
                <td>{displayValue(row.payroll)}</td>
                <td>{displayValue(row.netProfit)}</td>
                <td>{displayValue(row.overheadTenPct)}</td>
                <td className="financeAnalyticsTdRent">
                  <input
                    type="number"
                    min={0}
                    step={1000}
                    className="financeAnalyticsRentInput"
                    value={rentSettings[row.storeName] ?? ''}
                    placeholder="₽"
                    aria-label={`Аренда ${row.storeName}`}
                    onChange={(event) =>
                      setRentSettings((current) => ({
                        ...current,
                        [row.storeName]: Number(event.target.value) || 0,
                      }))
                    }
                  />
                </td>
                <td>{displayValue(row.netAfterOverhead)}</td>
                <td className="financeAnalyticsTdPayback">
                  {row.paybackDays != null
                    ? `${row.paybackDays} дн.`
                    : row.rentTotal > 0 && row.netProfit - row.overheadTenPct <= 0
                      ? '—'
                      : '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="financeAnalyticsTableHint">
          Аренда — общая сумма. Окупаемость: сколько дней точка отбивает её с чистой прибыли (минус 10% кассы).
        </p>
      </section>
    </div>
  );
}
