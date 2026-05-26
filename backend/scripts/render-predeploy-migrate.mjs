/**
 * Перед стартом API на Render: чинит «застрявшую» миграцию 0028 (P3009) и применяет остальные.
 * Идемпотентно: безопасно вызывать при каждом деплое.
 */
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const backendRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const MIGRATION_0028 = '0028_dual_regional_warehouses';

function run(cmd, extra = {}) {
  execSync(cmd, {
    cwd: backendRoot,
    stdio: 'inherit',
    env: process.env,
    ...extra,
  });
}

function runQuiet(cmd, extra = {}) {
  return execSync(cmd, {
    cwd: backendRoot,
    encoding: 'utf8',
    env: process.env,
    stdio: ['pipe', 'pipe', 'pipe'],
    ...extra,
  });
}

function tryMigrateDeploy() {
  try {
    runQuiet('npx prisma migrate deploy');
    return { ok: true, output: '' };
  } catch (error) {
    const stdout = error.stdout?.toString?.() ?? '';
    const stderr = error.stderr?.toString?.() ?? '';
    const message = error.message?.toString?.() ?? '';
    return { ok: false, output: `${stdout}\n${stderr}\n${message}` };
  }
}

function repairFailed0028() {
  const sqlPath = join(
    backendRoot,
    'prisma/migrations',
    MIGRATION_0028,
    'migration.sql',
  );
  const sql = readFileSync(sqlPath, 'utf8');
  console.log(`[migrate] Repairing failed migration ${MIGRATION_0028}…`);
  runQuiet('npx prisma db execute --stdin', { input: sql });
  run('npx prisma migrate resolve --applied 0028_dual_regional_warehouses');
}

function main() {
  if (!process.env.DATABASE_URL) {
    console.warn('[migrate] DATABASE_URL is not set — skipping prisma migrate deploy.');
    return;
  }

  const first = tryMigrateDeploy();
  if (first.ok) {
    console.log('[migrate] prisma migrate deploy — OK');
    return;
  }

  const needsRepair =
    first.output.includes('P3009') && first.output.includes(MIGRATION_0028);

  if (!needsRepair) {
    console.error(first.output);
    process.exit(1);
  }

  repairFailed0028();

  const second = tryMigrateDeploy();
  if (!second.ok) {
    console.error(second.output);
    process.exit(1);
  }

  console.log('[migrate] prisma migrate deploy — OK (after repair)');
}

main();
