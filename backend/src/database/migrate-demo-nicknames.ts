import type { PrismaClient } from '@prisma/client';
import { DEMO_STORE_NAMES } from '../auth/demo-stores';

/**
 * Однократно переименовывает старые демо-ники (admin1 → a1 и т.д.), если новый ник ещё свободен.
 */
export async function migrateLegacyDemoNicknames(prisma: PrismaClient): Promise<void> {
  const pairs: Array<readonly [string, string]> = [
    ...DEMO_STORE_NAMES.map((_, i) => [`admin${i + 1}`, `a${i + 1}`] as const),
    ...DEMO_STORE_NAMES.map((_, i) => [`seller${i + 1}`, `s${i + 1}`] as const),
    ...DEMO_STORE_NAMES.map((_, i) => [`reto${i + 1}`, `r${i + 1}`] as const),
  ];

  for (const [fromNick, toNick] of pairs) {
    const fromUser = await prisma.user.findUnique({ where: { nickname: fromNick } });
    const toUser = await prisma.user.findUnique({ where: { nickname: toNick } });
    if (!fromUser || toUser) {
      continue;
    }
    await prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { nickname: fromNick },
        data: { nickname: toNick },
      });
      await tx.staffMember.updateMany({
        where: { nickname: fromNick },
        data: { nickname: toNick },
      });
    });
  }
}
