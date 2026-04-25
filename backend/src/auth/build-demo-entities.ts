import { DEMO_STORE_NAMES } from './demo-stores';

export function buildDefaultDemoUserRows() {
  const users: Array<{
    id: number;
    nickname: string;
    password: string;
    fullName: string;
    role: 'DIRECTOR' | 'ADMIN' | 'SELLER' | 'ACCOUNTANT';
    storeName: string;
    isActive: boolean;
  }> = [
    {
      id: 1,
      nickname: 'director',
      password: '123456',
      fullName: 'Директор',
      role: 'DIRECTOR',
      storeName: 'Все точки',
      isActive: true,
    },
    {
      id: 2,
      nickname: 'buh',
      password: '123456',
      fullName: 'Бухгалтер',
      role: 'ACCOUNTANT',
      storeName: 'Все точки',
      isActive: true,
    },
  ];
  for (let i = 0; i < DEMO_STORE_NAMES.length; i += 1) {
    const store = DEMO_STORE_NAMES[i];
    users.push({
      id: 3 + i,
      nickname: `admin${i + 1}`,
      password: '123456',
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
      nickname: `seller${i + 1}`,
      password: '123456',
      fullName: `Продавец — ${store}`,
      role: 'SELLER',
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
    nickname: `seller${i + 1}`,
    storeName,
    ratePercent: 3 + (i % 3) + 2,
  }));
}

export function buildDefaultStaffRows() {
  return buildDefaultSellerProfileRows().map((row) => ({
    id: row.id,
    fullName: row.fullName,
    nickname: row.nickname,
    isActive: true,
  }));
}
