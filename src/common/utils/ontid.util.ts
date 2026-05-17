import { PrismaService } from '../../prisma/prisma.service';

/**
 * Generates the next sequential ONTID in the format ONT-000001.
 * Uses a DB-level MAX query — collision-safe for the expected concurrency level.
 * ONTID is immutable once assigned; never regenerate for an existing user.
 */
export async function generateNextOntId(prisma: PrismaService): Promise<string> {
  const result = await prisma.$queryRaw<{ max_num: bigint | null }[]>`
    SELECT MAX(CAST(SUBSTRING(ont_id FROM 5) AS INTEGER)) AS max_num
    FROM users
    WHERE ont_id IS NOT NULL AND ont_id ~ '^ONT-[0-9]+$'
  `;
  const maxNum = result[0]?.max_num ? Number(result[0].max_num) : 0;
  const nextNum = maxNum + 1;
  return `ONT-${String(nextNum).padStart(6, '0')}`;
}
