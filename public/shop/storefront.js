import { $, esc, cash, api, post, toast, hanger, dialogs } from './shared.js';
import { photosFor } from './photos.js';
let catalog, category = 'All', currentProduct, galleryIndex = 0;
let bag = [];
try { const saved = JSON.parse(localStorage.getItem('chase-bag') || '[]'); if (Array.isArray(saved)) bag = saved.filter(i => typeof i?.productId === 'string' && typeof i.variantId === 'string' && Number.isInteger(i.quantity) && i.quantity > 0 && i.quantity <= 10).slice(0, 25); } catch {}
const saveBag = () => { try { localStorage.setItem('chase-bag', JSON.stringify(bag)); } catch {} $('#bag-count').textContent = bag.reduce((n,i) => n + i.quantity, 0); };
dialogs(); saveBag(); $('#year').textContent = new Date().getFullYear();
const image = (p, cls = '') => p.image ? `<img class="${cls}" src="${esc(p.image)}" alt="${esc(p.title)}" loading="lazy">` : hanger;
function showProducts() {
  const list = catalog.products.filter(p => category === 'All' || p.category === category);
  $('#product-count').textContent = `${list.length} ${list.length === 1 ? 'piece' : 'pieces'}`;
  $('#filters').innerHTML = ['All', ...new Set(catalog.products.map(p => p.category))].map(c => `<button class="filter ${c === category ? 'active' : ''}" data-category="${esc(c)}" aria-pressed="${c === category}">${esc(c)}</button>`).join('');
  $('#products').innerHTML = list.length ? list.map(p => `<button class="product-card" data-product="${p.id}"><span class="product-image">${image(p)}</span><span class="product-details"><span><h3>${esc(p.title)}</h3><p>${esc(p.category)}${p.variants.every(v=>!v.stock) ? ' · Sold out' : ''}</p></span><span class="price">${cash(p.priceCents)}</span></span></button>`).join('') : `<div class="empty">${hanger}<span class="eyebrow">Something good is coming</span><h2>The collection is on its way.</h2><p>New pieces will appear here when they’re ready.<br>Follow along for what’s next.</p><a href="https://www.instagram.com/chasemdg/" class="button" target="_blank" rel="noopener noreferrer">Follow @chasemdg ↗</a></div>`;
}
function detail(id) {
  currentProduct = catalog.products.find(p => p.id === id); if (!currentProduct) return;
  galleryIndex = 0;
  const p = currentProduct; $('#detail-title').textContent = p.title;
  $('#product-detail').innerHTML = `${productGallery(p)}<p class="description">${esc(p.description)}</p><p>${cash(p.priceCents)}</p><label class="field">Size / color<select id="variant">${p.variants.map(v => `<option value="${v.id}" ${!v.stock ? 'disabled' : ''}>${esc(v.size)} / ${esc(v.color)}${v.stock ? '' : ' — sold out'}</option>`).join('')}</select></label><label class="field">Quantity<input id="detail-quantity" type="number" min="1" max="10" value="1"></label><button id="add-to-bag" class="primary full" ${p.variants.every(v=>!v.stock) ? 'disabled' : ''}>${p.variants.every(v=>!v.stock) ? 'Sold out' : 'Add to bag'}</button><p class="small muted">Shipping calculated in your bag. ${!catalog.checkoutReady ? 'Checkout is not open yet.' : ''}</p>`;
  $('#product-dialog').showModal();
}
function productGallery(product) {
  const photos = photosFor(product);
  if (!photos.length) return `<div class="product-image">${hanger}</div>`;
  return `<section id="product-gallery" aria-label="Product photo gallery"><div class="gallery-main"><img id="gallery-image" class="detail-image" src="${esc(photos[0])}" alt="${esc(product.title)} — photo 1 of ${photos.length}">${photos.length > 1 ? '<button type="button" class="gallery-arrow gallery-prev" data-gallery-step="-1" aria-label="Previous photo">‹</button><button type="button" class="gallery-arrow gallery-next" data-gallery-step="1" aria-label="Next photo">›</button>' : ''}</div>${photos.length > 1 ? `<p id="gallery-count" class="small muted gallery-count" role="status" aria-live="polite">Photo 1 of ${photos.length}</p><div class="gallery-thumbnails">${photos.map((src, index) => `<button type="button" data-gallery-index="${index}" aria-label="Show photo ${index + 1}" aria-pressed="${index === 0}"><img src="${esc(src)}" alt="" loading="lazy"></button>`).join('')}</div>` : ''}</section>`;
}
function selectPhoto(index) {
  const photos = photosFor(currentProduct);
  if (!photos.length) return;
  galleryIndex = (index + photos.length) % photos.length;
  const main = $('#gallery-image');
  main.src = photos[galleryIndex]; main.alt = `${currentProduct.title} — photo ${galleryIndex + 1} of ${photos.length}`;
  const count = $('#gallery-count'); if (count) count.textContent = `Photo ${galleryIndex + 1} of ${photos.length}`;
  for (const button of document.querySelectorAll('[data-gallery-index]')) button.setAttribute('aria-pressed', String(Number(button.dataset.galleryIndex) === galleryIndex));
}
document.addEventListener('keydown', e => {
  if (!e.target.closest('#product-gallery') || !['ArrowLeft', 'ArrowRight'].includes(e.key)) return;
  e.preventDefault(); selectPhoto(galleryIndex + (e.key === 'ArrowLeft' ? -1 : 1));
});
function bagRows() {
  let subtotal = 0, valid = true;
  const rows = bag.map((item,index) => {
    const p = catalog?.products.find(p => p.id === item.productId), v = p?.variants.find(v => v.id === item.variantId);
    if (!p || !v) { valid = false; return `<div class="cart-row"><span></span><div>Item no longer available</div><button class="text-button" data-remove="${index}">Remove</button></div>`; }
    subtotal += p.priceCents * item.quantity;
    if (v.stock < item.quantity) valid = false;
    return `<div class="cart-row">${image(p)}<div><h3>${esc(p.title)}</h3><span class="small muted">${esc(v.size)} / ${esc(v.color)}</span><div class="quantity"><button data-quantity="${index}" data-delta="-1" aria-label="Decrease quantity">−</button><span>${item.quantity}</span><button data-quantity="${index}" data-delta="1" aria-label="Increase quantity">+</button><button class="text-button" data-remove="${index}">Remove</button></div>${v.stock < item.quantity ? '<p class="small danger">Quantity is no longer available.</p>' : ''}</div><span class="small">${cash(p.priceCents * item.quantity)}</span></div>`;
  }).join('');
  return { rows, subtotal, valid };
}
function showBag() {
  if (!catalog) return;
  const { rows, subtotal, valid } = bagRows();
  $('#bag-content').innerHTML = !bag.length ? '<p class="description">Your bag is empty. Find your next favorite piece.</p>' : `${rows}<div class="totals"><div><span>Subtotal</span><span>${cash(subtotal)}</span></div><div><span>Shipping</span><span>${catalog.settings.shippingCents ? cash(catalog.settings.shippingCents) : 'Free'}</span></div><div class="grand-total"><span>Total</span><span>${cash(subtotal + catalog.settings.shippingCents)}</span></div></div><p class="small muted">By continuing you agree to the shop’s shipping and return policies. Payment, billing, and shipping details are collected securely at checkout.</p><button class="primary full" id="checkout" ${!catalog.checkoutReady || !valid ? 'disabled' : ''}>${catalog.checkoutReady ? 'Continue to checkout ↗' : 'Checkout opening soon'}</button><p id="checkout-error" class="small danger" role="alert"></p>`;
}
$('#open-bag').addEventListener('click', () => { showBag(); $('#bag-dialog').showModal(); });
document.addEventListener('click', async e => {
  const thumbnail = e.target.closest('[data-gallery-index]'); if (thumbnail) selectPhoto(Number(thumbnail.dataset.galleryIndex));
  const step = e.target.closest('[data-gallery-step]'); if (step) selectPhoto(galleryIndex + Number(step.dataset.galleryStep));

  const filter = e.target.closest('[data-category]'); if (filter) { category = filter.dataset.category; showProducts(); }
  const p = e.target.closest('[data-product]'); if (p) detail(p.dataset.product);
  if (e.target.closest('#add-to-bag')) {
    const variant = currentProduct.variants.find(v => v.id === $('#variant').value), quantity = Number($('#detail-quantity').value);
    if (!variant || !Number.isInteger(quantity) || quantity < 1 || quantity > 10) return toast('Choose a valid size, color, and quantity.');
    const old = bag.find(i => i.productId === currentProduct.id && i.variantId === variant.id);
    if ((old?.quantity || 0) + quantity > Math.min(10, variant.stock)) return toast('That quantity is not available.');
    if (old) old.quantity += quantity; else bag.push({ productId: currentProduct.id, variantId: variant.id, quantity });
    saveBag(); $('#product-dialog').close(); toast('Added to your bag.');
  }
  const remove = e.target.closest('[data-remove]'); if (remove) { bag.splice(Number(remove.dataset.remove),1); saveBag(); showBag(); }
  const qty = e.target.closest('[data-quantity]'); if (qty) { const i = bag[Number(qty.dataset.quantity)]; i.quantity = Math.max(1, Math.min(10, i.quantity + Number(qty.dataset.delta))); saveBag(); showBag(); }
  if (e.target.closest('#checkout')) {
    const button = $('#checkout'); button.disabled = true; button.textContent = 'Opening secure checkout…';
    try { const result = await post('checkout', { items: bag }); const u = new URL(result.url); if (u.protocol !== 'https:' || u.hostname !== 'checkout.stripe.com') throw new Error('Invalid checkout destination.'); location.assign(u.href); }
    catch (error) { $('#checkout-error').textContent = error.message; button.disabled = false; button.textContent = 'Try checkout again'; }
  }
  const policy = e.target.closest('[data-policy]'); if (policy && catalog) {
    const key = policy.dataset.policy;
    $('#policy-title').textContent = key === 'shippingPolicy' ? 'Shipping' : key === 'returnPolicy' ? 'Returns' : 'Privacy';
    $('#policy-body').textContent = key === 'privacy' ? 'This shop stores your order, email, billing address, and shipping address to process and fulfill purchases. Stripe processes payment details; your card number is never stored by this website. Your browser stores your shopping bag locally. The manager uses a secure login cookie. Order information is available only to the shop manager. For questions or requests about your information, contact the shop using the contact link below.' : catalog.settings[key] || 'This policy will be available before checkout opens.';
    $('#policy-dialog').showModal();
  }
});
try {
  catalog = await api('catalog');
  $('#shop-title').textContent = catalog.settings.title;
  $('#shop-tagline').textContent = catalog.settings.tagline;
  if (catalog.settings.contactEmail) { const link = $('#contact-link'); link.href = `mailto:${catalog.settings.contactEmail}`; link.textContent = 'Contact'; link.hidden = false; }
  const checkout = new URLSearchParams(location.search).get('checkout');
  if (checkout) {
    const notice = $('#checkout-notice'); notice.hidden = false;
    notice.textContent = checkout === 'complete' ? 'Thanks for checking out. Your order will be confirmed once payment is verified. Keep your payment receipt for reference.' : 'Checkout was canceled. Your bag is saved; reserved items may take about 30 minutes to become available again.';
    if (checkout === 'complete') { bag = []; saveBag(); }
    history.replaceState(null, '', '/shop/');
  }
  showProducts();
} catch (error) {
  $('#products').innerHTML = `<div class="empty"><h2>The collection couldn’t load.</h2><p>${esc(error.message)}</p><button class="secondary" id="reload">Try again</button></div>`;
  $('#reload').addEventListener('click', () => location.reload());
}
