import { DEMO_STORE_NAMES } from './demo-stores';
import { getDefaultDemoPassword } from './demo-password';

export function buildDefaultDemoUserRows() {
  const pwd = getDefaultDemoPassword();
  const users: Array<{
    id: number;
    nickname: string;
    password: string;
    fullName: string;
    role: 'DIRECTOR' | 'MANAGER' | 'ADMIN' | 'SELLER' | 'ACCOUNTANT' | 'RETOUCHER';
    storeName: string;
    isActive: boolean;
  }> = [
    {
      id: 1,
      nickname: 'director',
      password: pwd,
      fullName: 'Директор',
      role: 'DIRECTOR',
      storeName: 'Все точки',
      isActive: true,
    },
    {
      id: 2,
      nickname: 'buh',
      password: pwd,
      fullName: 'Бухгалтер',
      role: 'ACCOUNTANT',
      storeName: 'Все точки',
      isActive: true,
    },
    {
      id: 27,
      nickname: 'manager',
      password: pwd,
      fullName: 'Управляющий',
      role: 'MANAGER',
      storeName: 'Все точки',
      isActive: true,
    },
  ];
  for (let i = 0; i < DEMO_STORE_NAMES.length; i += 1) {
    const store = DEMO_STORE_NAMES[i];
    users.push({
      id: 3 + i,
      nickname: `a${i + 1}`,
      password: pwd,
      fullName: `Админ — ${store}`,
      role: 'ADMIN',
      storeName: store,
      isActive: true,
    });
  }
  for (let i = 0; i < DEMO_STORE_NAMES.length; i += 1) {
    const store = DEMO_STORE_NAMES[i];
    users.push({
      id: 11 + i,
      nickname: `s${i + 1}`,
      password: pwd,
      fullName: `Продавец — ${store}`,
      role: 'SELLER',
      storeName: store,
      isActive: true,
    });
  }
  for (let i = 0; i < DEMO_STORE_NAMES.length; i += 1) {
    const store = DEMO_STORE_NAMES[i];
    users.push({
      id: 19 + i,
      nickname: `r${i + 1}`,
      password: pwd,
      fullName: `Ретушёр — ${store}`,
      role: 'RETOUCHER',
      storeName: store,
      isActive: true,
    });
  }
  return users;
}

export function buildDefaultSellerProfileRows() {
  return DEMO_STORE_NAMES.map((storeName, i) => ({
    id: 11 + i,
    fullName: `Продавец — ${storeName}`,
    nickname: `s${i + 1}`,
    storeName,
    ratePercent: 3 + (i % 3) + 2,
  }));
}

export function buildDefaultStaffRows() {
  const sales = buildDefaultSellerProfileRows().map((row) => ({
    id: row.id,
    fullName: row.fullName,
    nickname: row.nickname,
    isActive: true,
    staffPosition: 'SALES' as const,
  }));
  const retouchers = DEMO_STORE_NAMES.map((storeName, i) => ({
    id: 19 + i,
    fullName: `Ретушёр — ${storeName}`,
    nickname: `r${i + 1}`,
    isActive: true,
    staffPosition: 'RETOUCHER' as const,
  }));
  return [...sales, ...retouchers];
}
