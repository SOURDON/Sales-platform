#!/usr/bin/env node
/** Восстановить привязки сотрудников к точкам с Render → Timeweb. */
const RENDER = process.env.RENDER_URL ?? 'https://sales-platform-1.onrender.com';
const TIMEWEB = process.env.TIMEWEB_URL ?? 'http://77.233.223.48';
const PASSWORD = process.env.RENDER_PASSWORD ?? 'Bufet000';

const VALID_STORES = new Set([
  'Сады морей Тех. зона',
  'Сады морей Пляж',
  'Метрополь',
  'Багамы',
  'Спортивнй',
  'Центр пляж',
  'Центр Тех. зона',
  'Дельфин Тех. зона',
]);

async function login(base) {
  const res = await fetch(`${base}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ nickname: 'director', password: PASSWORD }),
  });
  if (!res.ok) throw new Error(`${base} login ${res.status}`);
  return (await res.json()).token;
}

async function getStaff(base, token) {
  const res = await fetch(`${base}/admin/staff`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`staff ${res.status}`);
  return res.json();
}

async function removeFromStore(token, id, storeName) {
  const res = await fetch(`${TIMEWEB}/admin/staff/${id}/remove-from-store`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ storeName }),
  });
  return res.ok;
}

async function restoreToStore(token, id, storeName) {
  const res = await fetch(`${TIMEWEB}/admin/staff/${id}/restore-to-store`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ storeName }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`restore ${id}@${storeName}: ${res.status} ${text}`);
  }
}

function targetStores(member) {
  let raw = [];
  if (Array.isArray(member.assignedStores) && member.assignedStores.length > 0) {
    raw = member.assignedStores;
  } else {
    const home = member.storeName?.trim();
    if (home && home !== 'Все точки') {
      raw = [home];
    }
  }
  return raw.filter((s) => VALID_STORES.has(s));
}

async function main() {
  const rTok = await login(RENDER);
  const tTok = await login(TIMEWEB);
  const renderStaff = await getStaff(RENDER, rTok);
  const timewebStaff = await getStaff(TIMEWEB, tTok);
  const twById = new Map(timewebStaff.map((m) => [m.id, m]));

  let fixed = 0;
  for (const ref of renderStaff) {
    const tw = twById.get(ref.id);
    if (!tw) {
      console.warn('Нет на Timeweb:', ref.id, ref.nickname);
      continue;
    }
    const want = new Set(targetStores(ref));
    const have = new Set(targetStores(tw));
    if (want.size === have.size && [...want].every((s) => have.has(s))) {
      continue;
    }
    for (const sn of have) {
      if (!want.has(sn)) {
        await removeFromStore(tTok, ref.id, sn);
      }
    }
    for (const sn of want) {
      if (!have.has(sn)) {
        await restoreToStore(tTok, ref.id, sn);
      }
    }
    fixed += 1;
    console.log('OK', ref.nickname, '→', [...want].join(', '));
  }

  const check = await getStaff(TIMEWEB, tTok);
  const retouchers = check.filter((m) => m.staffPosition === 'RETOUCHER');
  const withStore = retouchers.filter((m) => targetStores(m).length > 0);
  console.log(`\nРетушёры с точкой: ${withStore.length}/${retouchers.length}`);
  console.log(fixed ? `Исправлено записей: ${fixed}` : 'Уже совпадало с Render');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
