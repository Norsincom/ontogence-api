import * as crypto from 'crypto';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * ONTID — Ontogence Identity
 *
 * Format: ONT-XXXXXXXX  (8 uppercase alphanumeric characters)
 * Example: ONT-7X4K92A1
 *
 * Properties:
 * - Cryptographically random (crypto.randomBytes)
 * - Non-sequential — never reveals signup order or user count
 * - Globally unique — collision-checked against DB before assignment
 * - Immutable — never changes after creation
 * - Operationally readable — short enough to communicate verbally
 *
 * Alphabet excludes visually ambiguous characters: I, O, 0, 1
 * Entropy: 32^8 = ~1 trillion possible values
 */

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const ONTID_LENGTH = 8;

function generateCandidate(): string {
  const bytes = crypto.randomBytes(ONTID_LENGTH);
  let result = 'ONT-';
  for (let i = 0; i < ONTID_LENGTH; i++) {
    result += ALPHABET[bytes[i] % ALPHABET.length];
  }
  return result;
}

/**
 * Generate a collision-safe random ONTID, validated against the DB.
 * Retries up to 10 times (collision probability is ~1 in 10^12 per attempt).
 */
export async function generateOntId(prisma: PrismaService): Promise<string> {
  for (let attempt = 0; attempt < 10; attempt++) {
    const candidate = generateCandidate();
    const existing = await prisma.user.findUnique({ where: { ontId: candidate } });
    if (!existing) {
      return candidate;
    }
  }
  throw new Error('ONTID generation failed after 10 attempts — collision loop detected');
}
