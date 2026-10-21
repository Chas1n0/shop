import { getStore } from '@netlify/blobs';
import { initialState, ShopError } from './domain.mjs';
import { STORAGE_SCOPE } from './deployment.mjs';

export function store(name = 'data') {
  // Preview/local deployments never share the production store.
  return getStore({ name: `chase-shop-${STORAGE_SCOPE}-${name}`, consistency: 'strong' });
}
export async function readState() {
  return (await store().get('state', { type: 'json' })) ?? initialState();
}
export async function mutateState(change, backend = store()) {
  for (let attempt = 0; attempt < 12; attempt++) {
    const current = await backend.getWithMetadata('state', { type: 'json' });
    const data = current?.data ?? initialState();
    const result = change(data);
    data.revision++;
    const write = await backend.setJSON('state', data, current ? { onlyIfMatch: current.etag } : { onlyIfNew: true });
    if (write.modified) return result;
  }
  throw new ShopError('The store is busy. Please try again.', 409);
}
export async function rateLimit(key, limit, seconds) {
  const backend = store('security');
  const bucket = Math.floor(Date.now() / (seconds * 1000));
  const k = `rate/${key}/${bucket}`;
  for (let i = 0; i < 12; i++) {
    const old = await backend.getWithMetadata(k, { type: 'json' });
    const count = old?.data?.count ?? 0;
    if (count >= limit) throw new ShopError('Too many attempts. Please try again later.', 429);
    const result = await backend.setJSON(k, { count: count + 1 }, old ? { onlyIfMatch: old.etag } : { onlyIfNew: true });
    if (result.modified) return;
  }
  throw new ShopError('Please try again later.', 429);
}
