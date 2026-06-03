import type { AppDb } from '../db';
import {
  createAuthSession,
  createUser,
  getUserByEmail,
  getUserById,
  updateUserPasswordHash,
} from '../db/repos';
import { hashPassword, verifyPassword } from '../lib/crypto';
import { normalizeAuthEmail } from '../lib/email';

const MIN_PASSWORD_LEN = 8;
const MAX_PASSWORD_LEN = 128;

export { normalizeAuthEmail };

export function assertPasswordStrength(password: string): string | null {
  if (password.length < MIN_PASSWORD_LEN) return 'password_too_short';
  if (password.length > MAX_PASSWORD_LEN) return 'password_too_long';
  return null;
}

function defaultDisplayNameFromEmail(email: string): string {
  const local = email.split('@')[0] ?? 'player';
  const name = local.replace(/[._]/g, ' ').trim();
  return name || 'Sudoku Player';
}

export async function registerWithPassword(
  db: AppDb,
  input: { email: string; password: string; displayName?: string },
) {
  const strength = assertPasswordStrength(input.password);
  if (strength) return { ok: false as const, error: strength };

  const email = normalizeAuthEmail(input.email);
  if (!email.includes('@')) return { ok: false as const, error: 'invalid_email' };

  const existing = await getUserByEmail(db, email);
  if (existing) return { ok: false as const, error: 'email_taken' };

  const passwordHash = await hashPassword(input.password);
  const displayName =
    input.displayName?.trim() || defaultDisplayNameFromEmail(email);

  const user = await createUser(db, {
    email,
    displayName,
    provider: 'email',
    passwordHash,
  });
  const session = await createAuthSession(db, user.id);
  return { ok: true as const, user, ...session };
}

export async function loginWithPassword(
  db: AppDb,
  input: { email: string; password: string },
) {
  const email = normalizeAuthEmail(input.email);
  const user = await getUserByEmail(db, email);
  if (!user?.passwordHash) {
    return { ok: false as const, error: 'invalid_credentials' };
  }

  const valid = await verifyPassword(input.password, user.passwordHash);
  if (!valid) return { ok: false as const, error: 'invalid_credentials' };

  const session = await createAuthSession(db, user.id);
  const full = (await getUserById(db, user.id))!;
  return { ok: true as const, user: full, ...session };
}

export async function changeUserPassword(
  db: AppDb,
  userId: string,
  input: { currentPassword: string; newPassword: string },
) {
  const strength = assertPasswordStrength(input.newPassword);
  if (strength) return { ok: false as const, error: strength };

  const user = await getUserById(db, userId);
  if (!user?.passwordHash) {
    return { ok: false as const, error: 'password_not_set' };
  }

  const valid = await verifyPassword(input.currentPassword, user.passwordHash);
  if (!valid) return { ok: false as const, error: 'wrong_password' };

  const passwordHash = await hashPassword(input.newPassword);
  await updateUserPasswordHash(db, userId, passwordHash);
  return { ok: true as const };
}
