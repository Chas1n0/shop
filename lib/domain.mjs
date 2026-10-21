import { randomUUID } from 'node:crypto';

export class ShopError extends Error {
  constructor(message, status = 400) { super(message); this.status = status; }
}
export const text = (v, max = 200) => String(v ?? '').trim().slice(0, max);
export const initialState = () => ({ revision: 0, products: [], orders: {}, settings: {
  title: 'The Shop', tagline: 'A collection by Chase McDougall.', checkoutEnabled: false,
  shippingCents: 0, countries: ['US'], contactEmail: '', shippingPolicy: '', returnPolicy: ''
} });
export function money(v) {
  if (!Number.isSafeInteger(v) || v < 0 || v > 10000000) throw new ShopError('Enter a valid price in cents.');
  return v;
}
export function imageURL(v) {
  const value = text(v, 2000);
  if (!value) return '';
  if (/^\/api\/shop\/image\/[a-f0-9-]+$/.test(value)) return value;
  try { const u = new URL(value); if (u.protocol === 'https:' && !u.username && !u.password) return u.href; } catch {}
  throw new ShopError('Use an uploaded image or a valid HTTPS image URL.');
}
export function validateProduct(input, previous) {
  if (!input || typeof input !== 'object') throw new ShopError('Invalid product.');
  const title = text(input.title, 120);
  if (!title) throw new ShopError('A product title is required.');
  const priceCents = money(input.priceCents);
  if (!priceCents) throw new ShopError('Product price must be greater than zero.');
  if (!Array.isArray(input.variants) || input.variants.length < 1 || input.variants.length > 100) throw new ShopError('Add between 1 and 100 size/color combinations.');
  const seen = new Set(), ids = new Set();
  const variants = input.variants.map(v => {
    const size = text(v.size, 30), color = text(v.color, 40);
    if (!size || !color) throw new ShopError('Every variant needs a size and color.');
    const key = `${size.toLowerCase()}|${color.toLowerCase()}`;
    if (seen.has(key)) throw new ShopError('Each size/color combination must be unique.');
    seen.add(key);
    if (!Number.isSafeInteger(v.stock) || v.stock < 0 || v.stock > 9999) throw new ShopError('Stock must be a whole number between 0 and 9999.');
    const old = previous?.variants.find(p => p.id === v.id);
    const id = old?.id ?? randomUUID();
    if (ids.has(id)) throw new ShopError('Duplicate variant.');
    ids.add(id);
    return { id, size, color, stock: v.stock };
  });
  return { id: previous?.id ?? randomUUID(), title, priceCents,
    description: text(input.description, 4000), category: text(input.category, 40) || 'Clothing',
    image: imageURL(input.image), active: input.active === true, variants,
    createdAt: previous?.createdAt ?? new Date().toISOString(), updatedAt: new Date().toISOString() };
}
export function validateSettings(input, old) {
  const countries = Array.isArray(input.countries) ? [...new Set(input.countries)] : [];
  const supported = ['US', 'CA', 'GB', 'AU', 'NZ', 'DE', 'FR', 'IE', 'NL'];
  if (!countries.length || countries.some(c => !supported.includes(c))) throw new ShopError('Select a supported shipping country.');
  const contactEmail = text(input.contactEmail, 254);
  if (contactEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contactEmail)) throw new ShopError('Enter a valid contact email.');
  const s = { ...old, title: text(input.title, 80) || 'The Shop', tagline: text(input.tagline, 200),
    shippingCents: money(input.shippingCents), countries, contactEmail,
    shippingPolicy: text(input.shippingPolicy, 4000), returnPolicy: text(input.returnPolicy, 4000),
    checkoutEnabled: input.checkoutEnabled === true };
  if (s.checkoutEnabled && (!s.contactEmail || !s.shippingPolicy || !s.returnPolicy)) throw new ShopError('Add your contact email, shipping policy, and return policy before enabling checkout.');
  return s;
}
export function reserveOrder(state, cart, id = randomUUID()) {
  if (!Array.isArray(cart) || !cart.length || cart.length > 25) throw new ShopError('Your bag must contain between 1 and 25 items.');
  const merged = new Map();
  for (const item of cart) {
    if (!item || !Number.isSafeInteger(item.quantity) || item.quantity < 1 || item.quantity > 10) throw new ShopError('Choose a quantity between 1 and 10.');
    const key = `${item.productId}:${item.variantId}`;
    const prior = merged.get(key);
    const quantity = (prior?.quantity ?? 0) + item.quantity;
    if (quantity > 10) throw new ShopError('Maximum 10 of each size/color per order.');
    merged.set(key, { ...item, quantity });
  }
  // Validate the complete bag before changing stock.
  const items = [...merged.values()].map(item => {
    const p = state.products.find(p => p.id === item.productId && p.active);
    const v = p?.variants.find(v => v.id === item.variantId);
    if (!p || !v) throw new ShopError('An item is no longer available. Refresh your bag.');
    if (v.stock < item.quantity) throw new ShopError(`Not enough stock for ${p.title} (${v.size}, ${v.color}).`);
    return { productId: p.id, variantId: v.id, title: p.title, size: v.size, color: v.color,
      priceCents: p.priceCents, image: p.image, quantity: item.quantity };
  });
  for (const item of items) state.products.find(p => p.id === item.productId).variants.find(v => v.id === item.variantId).stock -= item.quantity;
  const subtotal = items.reduce((n, i) => n + i.priceCents * i.quantity, 0);
  const order = { id, status: 'pending', fulfillment: 'unfulfilled', items, subtotal,
    shippingCents: state.settings.shippingCents, total: subtotal + state.settings.shippingCents,
    currency: 'usd', createdAt: new Date().toISOString(), sessionId: null, tracking: '' };
  state.orders[id] = order;
  return order;
}
export function releaseOrder(state, id, status = 'expired') {
  const o = state.orders[id];
  if (!o || o.status !== 'pending') return false;
  for (const item of o.items) {
    const v = state.products.find(p => p.id === item.productId)?.variants.find(v => v.id === item.variantId);
    if (v) v.stock += item.quantity;
  }
  o.status = status;
  return true;
}
export function applyPayment(state, session) {
  const id = session.metadata?.order_id;
  const o = state.orders[id];
  if (!o) throw new ShopError('Unknown order.', 409);
  if (o.sessionId && o.sessionId !== session.id) throw new ShopError('Session mismatch.', 409);
  if (session.payment_status !== 'paid') return false;
  if (session.currency !== 'usd' || session.amount_total !== o.total) throw new ShopError('Payment total mismatch.', 409);
  if (o.status === 'paid') return false;
  if (o.status !== 'pending') throw new ShopError('Order is not pending; review this payment in Stripe.', 409);
  const shipping = session.collected_information?.shipping_details ?? session.shipping_details;
  if (!shipping?.address) throw new ShopError('Shipping address missing.', 409);
  o.status = 'paid'; o.sessionId = session.id; o.paidAt = new Date().toISOString();
  o.livemode = session.livemode === true;
  o.customer = { name: session.customer_details?.name ?? shipping.name ?? '',
    email: session.customer_details?.email ?? '', billing: session.customer_details?.address ?? null,
    shipping: { name: shipping.name ?? '', address: shipping.address } };
  return true;
}
