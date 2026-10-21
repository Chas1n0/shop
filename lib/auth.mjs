import { scryptSync, timingSafeEqual, randomUUID, createHash } from 'node:crypto';
import { sealData, unsealData } from 'iron-session';
import { ShopError } from './domain.mjs';
import { store } from './storage.mjs';
export const COOKIE = '__Host-chase-manager';
const ttl = 60 * 60 * 8;
export function authReady() {
  return Boolean(process.env.MANAGER_EMAIL && /^scrypt:[a-f0-9]{32}:[a-f0-9]{128}$/.test(process.env.MANAGER_PASSWORD_HASH ?? '') && process.env.SESSION_SECRET?.length >= 32);
}
export function verifyPassword(password, encoded = process.env.MANAGER_PASSWORD_HASH) {
  if (typeof password !== 'string' || password.length > 256 || !/^scrypt:[a-f0-9]{32}:[a-f0-9]{128}$/.test(encoded ?? '')) return false;
  const [, salt, hash] = encoded.split(':');
  return timingSafeEqual(scryptSync(password, salt, 64), Buffer.from(hash, 'hex'));
}
export function sameOrigin(req) {
  const origin = req.headers.get('origin');
  const expected = new URL(process.env.SITE_URL || req.url).origin;
  if (!origin || origin !== expected) throw new ShopError('Request origin rejected.', 403);
}
export async function createSession() {
  if (!authReady()) throw new ShopError('Manager login has not been configured.', 503);
  const id = randomUUID();
  await store('security').setJSON(`session/${id}`, { expires: Date.now() + ttl * 1000 });
  const token = await sealData({ id }, { password: process.env.SESSION_SECRET, ttl });
  return `${COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${ttl}`;
}
export async function requireManager(req) {
  if (!authReady()) throw new ShopError('Manager login has not been configured.', 503);
  const raw = req.headers.get('cookie')?.split(';').map(x => x.trim()).find(x => x.startsWith(`${COOKIE}=`))?.slice(COOKIE.length + 1);
  if (!raw) throw new ShopError('Please sign in.', 401);
  let session;
  try { session = await unsealData(decodeURIComponent(raw), { password: process.env.SESSION_SECRET, ttl }); } catch { throw new ShopError('Please sign in.', 401); }
  if (!/^[a-f0-9-]{36}$/.test(session?.id ?? '')) throw new ShopError('Please sign in.', 401);
  const stored = await store('security').get(`session/${session.id}`, { type: 'json' });
  if (!stored || stored.expires < Date.now()) throw new ShopError('Session expired. Please sign in.', 401);
  return session;
}
export const ipKey = value => createHash('sha256').update(value || 'unknown').digest('hex').slice(0, 32);
