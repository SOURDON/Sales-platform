export type DirectorDashboardStoreRow = {
  name: string;
  revenue: string;
  salaries: string;
};

export type DirectorDashboardResponse = {
  role: 'DIRECTOR';
  sellerDataManagedByAdmin: true;
  title: 'Сводка директора';
  metrics: Array<{ label: string; value: string }>;
  stores: DirectorDashboardStoreRow[];
};

type SellerLike = {
  id: number;
  storeName: string;
  salesAmount: number;
  commissionAmount: number;
};

type StaffLike = {
  id: number;
  isActive: boolean;
  staffPosition: string;
  storeName: string;
  assignedStores?: string[];
  earningsAmount: number;
};

type SaleLike = {
  sellerId: number;
  totalAmount: number;
};

function formatRub(value: number): string {
  return `${Math.round(value).toLocaleString('ru-RU')} ₽`;
}

function staffStores(member: StaffLike): string[] {
  const fromApi = Array.isArray(member.assignedStores) ? member.assignedStores : [];
  const assigned = fromApi.filter((name) => typeof name === 'string' && name.trim());
  if (assigned.length > 0) {
    return assigned;
  }
  return member.storeName?.trim() ? [member.storeName.trim()] : [];
}

export function buildEmptyDirectorDashboard(): DirectorDashboardResponse {
  return {
    role: 'DIRECTOR',
    sellerDataManagedByAdmin: true,
    title: 'Сводка директора',
    metrics: [
      { label: 'Выручка (все точки)', value: formatRub(0) },
      { label: 'Чистая прибыль (оценка)', value: formatRub(0) },
      { label: 'Выплаты персоналу', value: formatRub(0) },
    ],
    stores: [],
  };
}

/** Сводка директора из локальных продаж и персонала — как на сервере, без сети. */
export function buildDirectorHomeDashboard(
  sellers: SellerLike[],
  sales: SaleLike[],
  staff: StaffLike[],
): DirectorDashboardResponse {
  const revenueByStore = new Map<string, number>();
  const salaryByStore = new Map<string, number>();
  const sellerStore = new Map(sellers.map((seller) => [seller.id, seller.storeName]));

  for (const sale of sales) {
    const store = sellerStore.get(sale.sellerId)?.trim();
    if (!store) {
      continue;
    }
    revenueByStore.set(store, (revenueByStore.get(store) ?? 0) + sale.totalAmount);
  }
  if (revenueByStore.size === 0) {
    for (const seller of sellers) {
      const store = seller.storeName.trim();
      if (!store) {
        continue;
      }
      revenueByStore.set(store, (revenueByStore.get(store) ?? 0) + (seller.salesAmount || 0));
    }
  }

  for (const seller of sellers) {
    const store = seller.storeName.trim();
    if (!store) {
      continue;
    }
    salaryByStore.set(store, (salaryByStore.get(store) ?? 0) + (seller.commissionAmount || 0));
  }

  for (const member of staff) {
    if (!member.isActive || member.staffPosition !== 'RETOUCHER') {
      continue;
    }
    for (const store of staffStores(member)) {
      salaryByStore.set(store, (salaryByStore.get(store) ?? 0) + Math.round(member.earningsAmount || 0));
    }
  }

  const storeNames = [...new Set([...revenueByStore.keys(), ...salaryByStore.keys()])].sort((a, b) =>
    a.localeCompare(b, 'ru-RU'),
  );
  let totalRevenue = 0;
  let totalSalaries = 0;
  const stores = storeNames.map((name) => {
    const revenue = revenueByStore.get(name) ?? 0;
    const salaries = salaryByStore.get(name) ?? 0;
    totalRevenue += revenue;
    totalSalaries += salaries;
    return {
      name,
      revenue: formatRub(revenue),
      salaries: formatRub(salaries),
    };
  });
  const roughPurchases = Math.round(totalRevenue * 0.43);
  const netCompany = Math.max(0, Math.round(totalRevenue - roughPurchases - totalSalaries));
  return {
    role: 'DIRECTOR',
    sellerDataManagedByAdmin: true,
    title: 'Сводка директора',
    metrics: [
      { label: 'Выручка (все точки)', value: formatRub(Math.round(totalRevenue)) },
      { label: 'Чистая прибыль (оценка)', value: formatRub(netCompany) },
      { label: 'Выплаты персоналу', value: formatRub(Math.round(totalSalaries)) },
    ],
    stores,
  };
}
