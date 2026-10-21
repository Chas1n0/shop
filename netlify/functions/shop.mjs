import Stripe from 'stripe';
import { randomUUID } from 'node:crypto';
import { ShopError, text, validateProduct, validateSettings, reserveOrder, releaseOrder, applyPayment } from '../../lib/domain.mjs';
import { store, readState, mutateState, rateLimit } from '../../lib/storage.mjs';
import { COOKIE, authReady, verifyPassword, sameOrigin, createSession, requireManager, ipKey } from '../../lib/auth.mjs';

const json = (body, status = 200, headers = {}) => Response.json(body, { status, headers: { 'Cache-Control': 'no-store', ...headers } });
const paymentsReady = () => Boolean(process.env.STRIPE_SECRET_KEY && process.env.STRIPE_WEBHOOK_SECRET && process.env.SITE_URL);
const stripe = () => new Stripe(process.env.STRIPE_SECRET_KEY, { maxNetworkRetries: 2, timeout: 15000 });
async function bodyJSON(req) {
  const raw = await req.text();
  if (raw.length > 100000) throw new ShopError('Request is too large.', 413);
  try { return JSON.parse(raw); } catch { throw new ShopError('Invalid JSON.'); }
}
const revisionCheck = (state, revision) => {
  if (state.revision !== revision) throw new ShopError('The store changed while you were editing. Refresh and try again.', 409);
};

export default async function handler(req, context = {}) {
  try {
    const url = new URL(req.url);
    const path = url.pathname.replace(/^\/(?:api\/shop|\.netlify\/functions\/shop)\/?/, '').replace(/\/$/, '');
    const method = req.method;
    if (path === 'webhook' && method === 'POST') return await webhook(req);
    if (method !== 'GET' && method !== 'HEAD') sameOrigin(req);

    if (path === 'catalog' && method === 'GET') {
      const state = await readState();
      return json({ settings: state.settings, products: state.products.filter(p => p.active),
        checkoutReady: paymentsReady() && state.settings.checkoutEnabled });
    }
    if (/^image\/[a-f0-9-]{36}$/.test(path) && method === 'GET') {
      const result = await store('images').getWithMetadata(path.slice(6), { type: 'arrayBuffer' });
      if (!result) throw new ShopError('Image not found.', 404);
      return new Response(result.data, { headers: { 'Content-Type': result.metadata.contentType,
        'Cache-Control': 'public, max-age=31536000, immutable', 'X-Content-Type-Options': 'nosniff' } });
    }
    if (path === 'login' && method === 'POST') {
      if (!authReady()) throw new ShopError('Manager login needs configuration in Netlify. See the repository setup guide.', 503);
      await rateLimit(`login-${ipKey(context.ip)}`, 8, 900);
      const body = await bodyJSON(req);
      const validPassword = verifyPassword(body.password);
      if (!validPassword || text(body.email, 254).toLowerCase() !== process.env.MANAGER_EMAIL.toLowerCase()) throw new ShopError('Incorrect email or password.', 401);
      return json({ ok: true }, 200, { 'Set-Cookie': await createSession() });
    }
    if (path === 'checkout' && method === 'POST') {
      if (!paymentsReady()) throw new ShopError('Checkout is not open yet.', 503);
      await rateLimit(`checkout-${ipKey(context.ip)}`, 15, 900);
      const body = await bodyJSON(req);
      const client = stripe();
      const order = await mutateState(state => {
        if (!state.settings.checkoutEnabled) throw new ShopError('Checkout is not open yet.', 503);
        if (!state.settings.contactEmail || !state.settings.shippingPolicy || !state.settings.returnPolicy) throw new ShopError('Checkout is not configured.', 503);
        return { ...reserveOrder(state, body.items), countries: state.settings.countries };
      });
      let session;
      try {
        session = await client.checkout.sessions.create({
          mode: 'payment', client_reference_id: order.id,
          metadata: { order_id: order.id },
          billing_address_collection: 'required',
          shipping_address_collection: { allowed_countries: order.countries },
          line_items: order.items.map(i => ({ quantity: i.quantity, price_data: {
            currency: 'usd', unit_amount: i.priceCents, product_data: {
              name: i.title, description: `${i.size} / ${i.color}`
            }
          } })),
          shipping_options: [{ shipping_rate_data: { type: 'fixed_amount',
            fixed_amount: { amount: order.shippingCents, currency: 'usd' }, display_name: 'Shipping' } }],
          success_url: `${new URL(process.env.SITE_URL).origin}/shop/?checkout=complete`,
          cancel_url: `${new URL(process.env.SITE_URL).origin}/shop/?checkout=canceled`,
          expires_at: Math.floor(Date.now() / 1000) + 1800,
          integration_identifier: 'chase_shop_ngrqvtsz'
        }, { idempotencyKey: order.id });
      } catch (error) {
        // A timeout can mean Stripe created the session. Keep that reservation;
        // only release on a definite rejected request. Metadata lets webhooks recover it.
        if (error.type === 'StripeInvalidRequestError' || error.type === 'StripeAuthenticationError') {
          await mutateState(state => releaseOrder(state, order.id, 'failed'));
        }
        throw new ShopError('Checkout could not start. Please contact the shop before retrying if an item became unavailable.', 503);
      }
      await mutateState(state => { const o = state.orders[order.id]; if (!o.sessionId) o.sessionId = session.id; });
      return json({ url: session.url });
    }

    const manager = await requireManager(req);
    if (path === 'logout' && method === 'POST') {
      await store('security').delete(`session/${manager.id}`);
      return json({ ok: true }, 200, { 'Set-Cookie': `${COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0` });
    }
    if (path === 'admin' && method === 'GET') {
      const state = await readState();
      return json({ ...state, paymentsReady: paymentsReady(),
        testMode: !/^(sk|rk)_live_/.test(process.env.STRIPE_SECRET_KEY ?? '') });
    }
    if (path === 'products' && method === 'POST') {
      const input = await bodyJSON(req);
      if (!input?.product || typeof input.product !== 'object') throw new ShopError('A product is required.');
      const saved = await mutateState(state => {
        revisionCheck(state, input.revision);
        const previous = input.product.id ? state.products.find(p => p.id === input.product.id) : undefined;
        if (input.product.id && !previous) throw new ShopError('Product not found.', 404);
        const product = validateProduct(input.product, previous);
        for (const o of Object.values(state.orders).filter(o => o.status === 'pending')) {
          for (const item of o.items.filter(i => i.productId === product.id)) {
            if (!product.variants.some(v => v.id === item.variantId)) throw new ShopError('This variant has a pending checkout. Keep it until the checkout is paid or expired.');
          }
        }
        if (previous) state.products[state.products.findIndex(p => p.id === product.id)] = product;
        else state.products.unshift(product);
        return product;
      });
      return json({ product: saved });
    }
    if (path === 'settings' && method === 'POST') {
      const input = await bodyJSON(req);
      await mutateState(state => { revisionCheck(state, input.revision); state.settings = validateSettings(input.settings, state.settings); });
      return json({ ok: true });
    }
    if (path === 'upload' && method === 'POST') {
      const bytes = Buffer.from(await req.arrayBuffer());
      if (bytes.length > 3 * 1024 * 1024 || bytes.length < 12) throw new ShopError('Upload an image under 3 MB.', 413);
      let type;
      if (bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) type = 'image/png';
      else if (bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) type = 'image/jpeg';
      else if (bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP') type = 'image/webp';
      else if (['GIF87a','GIF89a'].includes(bytes.toString('ascii', 0, 6))) type = 'image/gif';
      if (!type) throw new ShopError('Upload a JPEG, PNG, WebP, or GIF image.');
      const id = randomUUID();
      await store('images').set(id, bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), { metadata: { contentType: type } });
      return json({ image: `/api/shop/image/${id}` });
    }
    if (path === 'orders/fulfill' && method === 'POST') {
      const input = await bodyJSON(req);
      await mutateState(state => {
        const o = state.orders[input.id];
        if (!o || o.status !== 'paid') throw new ShopError('Only paid orders can be marked shipped.');
        o.fulfillment = input.shipped === true ? 'shipped' : 'unfulfilled';
        o.tracking = text(input.tracking, 300);
        o.shippedAt = input.shipped ? new Date().toISOString() : null;
      });
      return json({ ok: true });
    }
    if (path === 'orders/reconcile' && method === 'POST') {
      if (!paymentsReady()) throw new ShopError('Stripe is not configured.', 503);
      const input = await bodyJSON(req);
      const state = await readState();
      const o = state.orders[input.id];
      if (!o || o.status !== 'pending') throw new ShopError('Choose a pending order.');
      if (!o.sessionId) throw new ShopError('Session was not recorded. Check Stripe for this order ID before adjusting inventory manually.');
      const session = await stripe().checkout.sessions.retrieve(o.sessionId);
      await mutateState(state => {
        if (session.payment_status === 'paid') applyPayment(state, session);
        else if (session.status === 'expired') releaseOrder(state, o.id);
      });
      return json({ ok: true });
    }
    throw new ShopError('Not found.', 404);
  } catch (error) {
    if (error instanceof ShopError) return json({ error: error.message }, error.status);
    // Do not log customer records, request bodies, cookies, or payment secrets.
    console.error('Shop request failed:', error.name || 'Error');
    return json({ error: 'The shop is temporarily unavailable. Please try again.' }, 503);
  }
}

async function webhook(req) {
  if (!paymentsReady()) throw new ShopError('Webhook is not configured.', 503);
  let event;
  const raw = await req.text();
  try { event = stripe().webhooks.constructEvent(raw, req.headers.get('stripe-signature'), process.env.STRIPE_WEBHOOK_SECRET); }
  catch { throw new ShopError('Invalid webhook signature.', 400); }
  const session = event.data.object;
  const keyIsLive = /^(sk|rk)_live_/.test(process.env.STRIPE_SECRET_KEY);
  if (event.livemode !== keyIsLive) throw new ShopError('Payment environment mismatch.', 400);
  // This Stripe account may also receive payments from other websites.
  if (!session.metadata?.order_id) return json({ received: true });
  if (['checkout.session.completed', 'checkout.session.async_payment_succeeded'].includes(event.type)) {
    await mutateState(state => applyPayment(state, session));
  } else if (['checkout.session.expired', 'checkout.session.async_payment_failed'].includes(event.type)) {
    await mutateState(state => {
      const o = state.orders[session.metadata?.order_id];
      if (o && (!o.sessionId || o.sessionId === session.id) && session.payment_status !== 'paid') releaseOrder(state, o.id);
    });
  }
  return json({ received: true });
}
