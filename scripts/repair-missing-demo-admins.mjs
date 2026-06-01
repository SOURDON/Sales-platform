#!/usr/bin/env node
/**
 * Проверяет /director/demo-accounts и сообщает, если нет админов a1/a2 (Сады морей).
 * При необходимости создаёт пользователей через ensure-demo на сервере (git pull + docker compose).
 *
 *   node scripts/repair-missing-demo-admins.mjs
 *   TIMEWEB_API=http://77.233.223.48 DIRECTOR_PASSWORD=Bufet000 node scripts/repair-missing-demo-admins.mjs
 */
const API = (process.env.TIMEWEB_API || process.env.VITE_API_URL || 'http://77.233.223.48').replace(
  /\/$/,
  '',
);
const DIRECTOR_NICK = process.env.DIRECTOR_NICK || 'director';
const DIRECTOR_PASSWORD = process.env.DIRECTOR_PASSWORD || 'Bufet000';

const EXPECTED_SADY_ADMINS = [
  { nick: 'a1', store: 'Сады морей Тех. зона' },
  { nick: 'a2', store: 'Сады морей Пляж' },
];

async function main() {
  const loginRes = await fetch(`${API}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ nickname: DIRECTOR_NICK, password: DIRECTOR_PASSWORD }),
  });
  if (!loginRes.ok) {
    console.error('Login failed', loginRes.status, await loginRes.text());
    process.exit(1);
  }
  const { token } = await loginRes.json();
  const res = await fetch(`${API}/director/demo-accounts`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    console.error('demo-accounts failed', res.status);
    process.exit(1);
  }
  const rows = await res.json();
  const admins = rows.filter((r) => r.role === 'ADMIN');
  console.log(`API ${API}: ${admins.length} admin accounts`);
  for (const { nick, store } of EXPECTED_SADY_ADMINS) {
    const row = admins.find((a) => a.nickname === nick);
    if (!row) {
      console.log(`MISSING: ${nick} (${store})`);
    } else if (row.storeName !== store) {
      console.log(`WRONG STORE: ${nick} → "${row.storeName}" (expected "${store}")`);
    } else {
      console.log(`OK: ${nick} → ${store}`);
    }
  }
  const missing = EXPECTED_SADY_ADMINS.filter((e) => !admins.some((a) => a.nickname === e.nick));
  if (missing.length > 0) {
    console.log('\nНа сервере (SSH), НЕ на Mac:');
    console.log('  cd /opt/sales-platform && git pull');
    console.log('  bash scripts/timeweb/ensure-demo-admins.sh');
    process.exit(2);
  }
  console.log('\nВсе точки «Сады морей» на месте.');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
