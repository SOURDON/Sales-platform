#!/usr/bin/env node
/**
 * Перенос данных Render → Timeweb через API (запуск с Mac).
 * Требует на Timeweb свежий API (git pull + docker compose up -d --build api).
 */
const RENDER = process.env.RENDER_URL ?? 'https://sales-platform-1.onrender.com';
const TIMEWEB = process.env.TIMEWEB_URL ?? 'http://77.233.223.48';
const RENDER_PASSWORD = process.env.RENDER_PASSWORD ?? 'Bufet000';
const TIMEWEB_PASSWORD = process.env.TIMEWEB_PASSWORD ?? 'Bufet000';

async function login(base, password) {
  const res = await fetch(`${base}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ nickname: 'director', password }),
  });
  if (!res.ok) {
    throw new Error(`${base} login ${res.status}: ${await res.text()}`);
  }
  return (await res.json()).token;
}

async function get(base, token, path) {
  const res = await fetch(`${base}${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    throw new Error(`${path} ${res.status}`);
  }
  return res.json();
}

async function main() {
  console.log('Render:', RENDER);
  console.log('Timeweb:', TIMEWEB);
  const renderTok = await login(RENDER, RENDER_PASSWORD);
  const timewebTok = await login(TIMEWEB, TIMEWEB_PASSWORD);
  console.log('OK login both');

  const [financeOps, sales, sellers, staff, shifts, writeOffs, products, procurementCosts] =
    await Promise.all([
      get(RENDER, renderTok, '/admin/finance/ops'),
      get(RENDER, renderTok, '/admin/sales'),
      get(RENDER, renderTok, '/admin/sellers'),
      get(RENDER, renderTok, '/admin/staff'),
      get(RENDER, renderTok, '/admin/shifts'),
      get(RENDER, renderTok, '/admin/write-offs'),
      get(RENDER, renderTok, '/admin/products'),
      get(RENDER, renderTok, '/admin/products/procurement-costs'),
    ]);

  console.log('Render data:', {
    sales: sales.length,
    staff: staff.length,
    financeExp: financeOps.expenses?.length ?? 0,
  });

  const snapshot = {
    financeOps,
    sales,
    sellers,
    staff,
    shifts,
    writeOffs,
    products,
    procurementCosts,
  };

  const res = await fetch(`${TIMEWEB}/admin/migrate/render-snapshot`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${timewebTok}`,
    },
    body: JSON.stringify(snapshot),
  });

  if (res.status === 404) {
    console.error(
      '\nНа Timeweb старый API. На сервере один раз:\n' +
        '  cd /opt/sales-platform && git pull && cd deploy/timeweb && docker compose --env-file .env up -d --build api\n' +
        'Подождите 2 мин и снова: node scripts/migrate-render-to-timeweb.mjs',
    );
    process.exit(1);
  }

  if (!res.ok) {
    console.error(await res.text());
    process.exit(1);
  }

  const out = await res.json();
  console.log('Timeweb migrate:', out);

  const check = await get(TIMEWEB, timewebTok, '/admin/sales');
  console.log('Timeweb sales after:', check.length);
  if (check.length < 1) {
    process.exit(1);
  }
  console.log('\nГотово. Fotografy: director / Bufet000 (или Foto-2026-9kLq если пароль не обновился)');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
