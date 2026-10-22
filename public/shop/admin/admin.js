import { $, esc, cash, api, post, toast, hanger, dialogs } from '../shared.js';
import { MAX_IMAGES, photosFor, addPhoto, movePhoto } from '../photos.js';
let state, tab = 'products', editing, editRevision, editorImages = [], uploadingPhotos = false;
dialogs();
function login(message = '') {
  $('#app').innerHTML = `<section class="login-wrap"><span class="eyebrow">For your eyes only</span><h1>Welcome back.</h1><p class="description">Sign in to manage your collection and orders.</p><form id="login-form"><label class="field">Email<input name="email" type="email" autocomplete="username" required></label><label class="field">Password<input name="password" type="password" autocomplete="current-password" required maxlength="256"></label><p id="login-error" class="small danger" role="alert">${esc(message)}</p><button class="primary full" type="submit">Sign in ↗</button></form><p class="small muted">Manager access is configured in your Netlify environment settings. There is no public registration.</p></section>`;
  $('#login-form').addEventListener('submit', async e => {
    e.preventDefault(); const f = e.currentTarget, b = $('button', f); b.disabled = true;
    try { await post('login', Object.fromEntries(new FormData(f))); await refresh(); }
    catch (err) { $('#login-error').textContent = err.message; b.disabled = false; }
  });
}
async function refresh() {
  state = await api('admin'); render();
}
function render() {
  const count = Object.values(state.orders).filter(o => o.status === 'paid' && o.fulfillment !== 'shipped').length;
  $('#app').innerHTML = `<div class="admin-layout"><aside class="sidebar" aria-label="Manager sections"><button data-tab="products" class="${tab === 'products' ? 'active' : ''}">Products</button><button data-tab="orders" class="${tab === 'orders' ? 'active' : ''}">Orders ${count ? `<span class="count">${count}</span>` : ''}</button><button data-tab="settings" class="${tab === 'settings' ? 'active' : ''}">Shop settings</button><div class="bottom"><button id="logout">Sign out ↗</button></div></aside><section class="workspace"><div class="workspace-head"><div><span class="eyebrow">Your store, your way</span><h1>${tab === 'products' ? 'The collection' : tab === 'orders' ? 'Your orders' : 'Shop settings'}</h1><p class="small muted">${tab === 'products' ? `${state.products.length} products · USD` : tab === 'orders' ? `${count} paid orders to ship` : 'Make it yours. Keep the details up to date.'}</p></div><div class="actions"><button id="refresh" class="secondary">Refresh</button>${tab === 'products' ? '<button id="new-product" class="primary">+ Add product</button>' : ''}</div></div><div id="manager-notice"></div><div id="workspace-content"></div></section></div>`;
  if (!state.paymentsReady) $('#manager-notice').innerHTML = '<div class="notice">Checkout is disabled until Stripe server credentials, the webhook signing secret, and SITE_URL are configured in Netlify.</div>';
  else if (state.testMode) $('#manager-notice').innerHTML = '<div class="notice">Stripe test mode. Payments are simulated; do not ship test orders.</div>';
  if (tab === 'products') products(); else if (tab === 'orders') orders(); else settings();
}
function products() {
  $('#workspace-content').innerHTML = state.products.length ? `<div class="admin-products">${state.products.map(p => `<article class="admin-card">${p.image ? `<img src="${esc(p.image)}" alt="${esc(p.title)}" loading="lazy">` : `<div class="product-image">${hanger}</div>`}<div class="admin-card-content"><span class="tag ${p.active ? '' : 'draft'}">${p.active ? 'Published' : 'Draft'}</span><h3>${esc(p.title)}</h3><p class="small muted">${cash(p.priceCents)} · ${p.variants.reduce((n,v)=>n+v.stock,0)} available</p><button class="secondary full" data-edit="${p.id}">Edit product</button></div></article>`).join('')}</div>` : `<div class="empty">${hanger}<h2>Your first piece starts here.</h2><p>Add a photo, set the price, and choose your sizes and colors.<br>You can save it as a draft before publishing.</p><button class="primary" id="empty-add">+ Add your first product</button></div>`;
}
function variantRow(v = {}) {
  return `<div class="variant-row" data-id="${esc(v.id || '')}"><input data-variant="size" aria-label="Size" placeholder="M" value="${esc(v.size || '')}" maxlength="30" required><input data-variant="color" aria-label="Color" placeholder="Black" value="${esc(v.color || '')}" maxlength="40" required><input data-variant="stock" aria-label="Available stock" type="number" min="0" max="9999" step="1" value="${v.stock ?? 0}" required><button type="button" class="text-button danger" data-remove-variant aria-label="Remove variant">×</button></div>`;
}
function editor(id) {
  editing = state.products.find(p => p.id === id); editRevision = state.revision;
  const p = editing || { title:'', priceCents:0, description:'', image:'', category:'Clothing', active:false, variants:[{size:'M',color:'Black',stock:0}] };
  editorImages = photosFor(p);
  $('#editor-title').textContent = editing ? 'Edit product' : 'Add a product';
  $('#product-form').innerHTML = `<label class="field">Product title<input name="title" value="${esc(p.title)}" maxlength="120" required placeholder="The everyday tee"></label><div class="row"><label class="field">Price (USD)<input name="price" type="number" min="0.01" max="100000" step="0.01" value="${p.priceCents ? (p.priceCents / 100).toFixed(2) : ''}" required placeholder="0.00"></label><label class="field">Category<input name="category" value="${esc(p.category)}" maxlength="40" list="categories"><datalist id="categories"><option>Tees</option><option>Hoodies</option><option>Outerwear</option><option>Accessories</option><option>Clothing</option></datalist></label></div><label class="field">Description<textarea name="description" maxlength="4000" placeholder="Fit, fabric, condition, and anything else buyers should know.">${esc(p.description)}</textarea></label><h3>Product photos</h3><p class="small muted">Add up to ${MAX_IMAGES} photos. The first photo is your cover image. JPEG, PNG, WebP, or GIF; under 3 MB each.</p><label class="field">Upload photos<input id="photo-upload" type="file" accept="image/jpeg,image/png,image/webp,image/gif" multiple></label><div class="photo-url-row"><label class="field">Or add an image URL<input name="imageUrl" type="url" placeholder="https://example.com/photo.jpg"></label><button type="button" id="add-photo-url" class="secondary">Add photo</button></div><p id="upload-status" class="small muted" role="status"></p><div id="photo-preview" class="photo-editor-grid"></div><h3>Sizes, colors & stock</h3><p class="small muted">Stock is the quantity available to buy, excluding items reserved by pending checkouts.</p><div class="variant-labels"><span>Size</span><span>Color</span><span>Available</span><span></span></div><div id="variant-rows">${p.variants.map(variantRow).join('')}</div><button type="button" id="add-variant" class="secondary">+ Add size / color</button><label class="checkbox"><input name="active" type="checkbox" ${p.active ? 'checked' : ''}>Publish in the shop</label><p class="small muted">Uncheck to hide a product without deleting its order history.</p><p id="product-error" class="small danger" role="alert"></p><button class="primary full" type="submit">Save product</button>`;
  renderEditorPhotos();
  $('#editor').showModal();
}
function renderEditorPhotos() {
  $('#photo-preview').innerHTML = editorImages.length ? editorImages.map((src, index) => `<div class="photo-editor-card"><img src="${esc(src)}" alt="Product photo ${index + 1}"><span class="photo-cover-label">${index === 0 ? 'Cover photo' : `Photo ${index + 1}`}</span><div class="photo-editor-actions"><button type="button" class="text-button" data-photo-cover="${index}" ${index === 0 || uploadingPhotos ? 'disabled' : ''}>Make cover</button><button type="button" class="text-button danger" data-photo-remove="${index}" ${uploadingPhotos ? 'disabled' : ''}>Remove</button></div><div class="photo-editor-actions"><button type="button" class="secondary" data-photo-move="${index}" data-direction="-1" aria-label="Move photo ${index + 1} earlier" ${index === 0 || uploadingPhotos ? 'disabled' : ''}>←</button><button type="button" class="secondary" data-photo-move="${index}" data-direction="1" aria-label="Move photo ${index + 1} later" ${index === editorImages.length - 1 || uploadingPhotos ? 'disabled' : ''}>→</button></div></div>`).join('') : '<p class="small muted">No photos yet. Upload photos or add an image URL above.</p>';
}
function addPhotoURL() {
  const input = $('#product-form input[name=imageUrl]');
  editorImages = addPhoto(editorImages, input.value);
  input.value = '';
  renderEditorPhotos();
}
$('#editor').addEventListener('cancel', e => { if (uploadingPhotos) e.preventDefault(); });
$('#editor').addEventListener('click', e => { if (uploadingPhotos && e.target === $('#editor')) e.stopImmediatePropagation(); }, { capture: true });
function address(a) { if (!a) return 'Not collected'; return [a.line1,a.line2,[a.city,a.state,a.postal_code].filter(Boolean).join(', '),a.country].filter(Boolean).map(esc).join('\n'); }
function orders() {
  const list = Object.values(state.orders).sort((a,b) => b.createdAt.localeCompare(a.createdAt));
  $('#workspace-content').innerHTML = `<div class="notice">Paid orders appear here after Stripe verifies payment. For email alerts, enable successful-payment notifications in your Stripe account settings. Refresh this page to check for new orders.</div>` + (list.length ? list.map(o => `<article class="order-card"><header><div><span class="eyebrow">${esc(new Date(o.createdAt).toLocaleString())}</span><h3>Order ${esc(o.id.slice(0,8).toUpperCase())}</h3><span class="small muted">${esc(o.id)}</span></div><div><span class="tag ${o.status !== 'paid' ? 'draft' : ''}">${esc(o.status)}${o.status === 'paid' ? ` · ${esc(o.fulfillment)}` : ''}</span>${o.livemode === false ? '<p class="small danger">TEST ORDER — do not ship</p>' : ''}<p>${cash(o.total)}</p></div></header><div class="order-items">${o.items.map(i=>`${esc(i.title)} · ${esc(i.size)} / ${esc(i.color)} × ${i.quantity} — ${cash(i.priceCents * i.quantity)}`).join('<br>')}<p class="small muted">Items ${cash(o.subtotal)} · Shipping ${cash(o.shippingCents)}</p></div>${o.customer ? `<div class="order-addresses"><div><b>Ship to</b><address>${esc(o.customer.shipping.name)}\n${address(o.customer.shipping.address)}</address><p>${esc(o.customer.email)}</p></div><div><b>Billing</b><address>${esc(o.customer.name)}\n${address(o.customer.billing)}</address></div></div>` : '<p class="small muted">Address details will appear after payment is verified. Stock is reserved while checkout is pending.</p>'}${o.status === 'paid' ? `<form class="fulfill-form" data-id="${o.id}"><label class="field">Tracking number / carrier notes<input name="tracking" value="${esc(o.tracking)}" maxlength="300" placeholder="Carrier and tracking number"></label><label class="checkbox"><input name="shipped" type="checkbox" ${o.fulfillment === 'shipped' ? 'checked' : ''}>Marked as shipped</label><button class="secondary" type="submit">Save fulfillment</button></form>` : o.status === 'pending' ? `<button class="secondary" data-reconcile="${o.id}">Check payment status</button>` : ''}</article>`).join('') : `<div class="empty"><span class="eyebrow">Ready when you are</span><h2>No orders yet.</h2><p>When someone checks out, their order will appear here.<br>You’ll see exactly what to pack and where to send it.</p></div>`);
}
function settings() {
  const s = state.settings;
  $('#workspace-content').innerHTML = `<form id="settings-form" class="settings-form"><div class="panel"><h2>The storefront</h2><label class="field">Shop title<input name="title" value="${esc(s.title)}" maxlength="80" required></label><label class="field">Short description<input name="tagline" value="${esc(s.tagline)}" maxlength="200"></label><label class="field">Customer support email<input name="contactEmail" value="${esc(s.contactEmail)}" type="email" maxlength="254" placeholder="you@example.com"></label></div><div class="panel"><h2>Shipping & returns</h2><label class="field">Flat shipping per order (USD)<input name="shipping" type="number" min="0" max="100000" step="0.01" value="${(s.shippingCents/100).toFixed(2)}" required><small>0 means free shipping. This applies to every selected country.</small></label><label class="field">Countries you ship to<select name="countries" multiple size="5">${[['US','United States'],['CA','Canada'],['GB','United Kingdom'],['AU','Australia'],['NZ','New Zealand'],['DE','Germany'],['FR','France'],['IE','Ireland'],['NL','Netherlands']].map(([c,n])=>`<option value="${c}" ${s.countries.includes(c)?'selected':''}>${n}</option>`).join('')}</select><small>Hold Ctrl (Windows) or Command (Mac) to choose multiple countries.</small></label><label class="field">Shipping policy<textarea name="shippingPolicy" maxlength="4000" placeholder="Where you ship, processing times, estimated delivery, and how customers can reach you.">${esc(s.shippingPolicy)}</textarea></label><label class="field">Return policy<textarea name="returnPolicy" maxlength="4000" placeholder="Return window, item condition, who pays return shipping, and how to request a return.">${esc(s.returnPolicy)}</textarea></label></div><div class="panel"><h2>Open for business</h2><label class="checkbox"><input name="checkoutEnabled" type="checkbox" ${s.checkoutEnabled?'checked':''}>Enable checkout</label><p class="small muted">Requires Stripe credentials, a webhook signing secret, and the contact and policy details above. Use a test key until a complete test order passes. Live payments require your activated Stripe account.</p><p class="small muted">Sales tax automation is not enabled. Configure applicable tax collection before taking orders where required. Refunds and disputes are managed in Stripe.</p></div><p id="settings-error" class="small danger" role="alert"></p><button class="primary" type="submit">Save settings</button></form>`;
}
document.addEventListener('click', async e => {
  if (uploadingPhotos && e.target.closest('#editor')) { if (e.target.closest('[data-close]')) e.stopImmediatePropagation(); return; }
  if (e.target.closest('#add-photo-url')) { try { addPhotoURL(); } catch (err) { toast(err.message); } }
  const coverPhoto = e.target.closest('[data-photo-cover]');
  if (coverPhoto) { editorImages = movePhoto(editorImages, Number(coverPhoto.dataset.photoCover), 0); renderEditorPhotos(); }
  const removePhoto = e.target.closest('[data-photo-remove]');
  if (removePhoto) { editorImages.splice(Number(removePhoto.dataset.photoRemove), 1); renderEditorPhotos(); }
  const move = e.target.closest('[data-photo-move]');
  if (move) { const from = Number(move.dataset.photoMove); editorImages = movePhoto(editorImages, from, from + Number(move.dataset.direction)); renderEditorPhotos(); }

  const t = e.target.closest('[data-tab]'); if (t) { tab = t.dataset.tab; render(); }
  if (e.target.closest('#new-product, #empty-add')) editor();
  const edit = e.target.closest('[data-edit]'); if (edit) editor(edit.dataset.edit);
  if (e.target.closest('#add-variant')) { if ($('#variant-rows').children.length < 100) $('#variant-rows').insertAdjacentHTML('beforeend',variantRow()); }
  const remove = e.target.closest('[data-remove-variant]'); if (remove && $('#variant-rows').children.length > 1) remove.parentElement.remove();
  if (e.target.closest('#logout')) { try { await post('logout',{}); login(); } catch(err){toast(err.message);} }
  if (e.target.closest('#refresh')) { try { await refresh(); toast('Store refreshed.'); } catch(err){handle(err);} }
  const reconcile = e.target.closest('[data-reconcile]'); if (reconcile) { reconcile.disabled = true; try { await post('orders/reconcile',{id:reconcile.dataset.reconcile}); await refresh(); toast('Payment status checked.'); } catch(err) { toast(err.message); reconcile.disabled = false; } }
});
document.addEventListener('change', async e => {
  if (e.target.id !== 'photo-upload' || !e.target.files.length || uploadingPhotos) return;
  const input = e.target, files = [...input.files];
  if (files.length + editorImages.length > MAX_IMAGES) { input.value = ''; return toast(`You can add ${MAX_IMAGES - editorImages.length} more photos.`); }
  if (files.some(file => file.size > 3 * 1024 * 1024)) { input.value = ''; return toast('Each photo must be under 3 MB.'); }
  const button = $('#product-form button[type=submit]');
  uploadingPhotos = true; button.disabled = true; input.disabled = true;
  $('#add-photo-url').disabled = true;
  $('#editor [data-close]').disabled = true;
  renderEditorPhotos();
  let uploaded = 0;
  try {
    for (const file of files) {
      $('#upload-status').textContent = `Uploading photo ${uploaded + 1} of ${files.length}…`;
      const data = await api('upload', { method:'POST', headers:{'Content-Type':file.type}, body:file });
      editorImages = addPhoto(editorImages, data.image);
      uploaded++; renderEditorPhotos();
    }
    $('#upload-status').textContent = `${uploaded} ${uploaded === 1 ? 'photo' : 'photos'} uploaded. Save the product to keep your changes.`;
  } catch(err) { $('#upload-status').textContent = `${uploaded} uploaded. ${err.message} Uploaded photos are still available below.`; }
  finally {
    uploadingPhotos = false; button.disabled = false; input.disabled = false; input.value = '';
    $('#add-photo-url').disabled = false; $('#editor [data-close]').disabled = false;
    renderEditorPhotos();
  }
});
document.addEventListener('submit', async e => {
  const f = e.target;
  if (!['product-form','settings-form'].includes(f.id) && !f.classList.contains('fulfill-form')) return;
  e.preventDefault(); if (uploadingPhotos) return; const data = new FormData(f), button = $('button[type=submit]', f); button.disabled = true;
  try {
    if (f.id === 'product-form') {
      addPhotoURL();
      const variants = [...$('#variant-rows').children].map(row => ({ id:row.dataset.id, size:$('[data-variant=size]',row).value, color:$('[data-variant=color]',row).value, stock:Number($('[data-variant=stock]',row).value) }));
      await post('products',{revision:editRevision,product:{id:editing?.id,title:data.get('title'),priceCents:Math.round(Number(data.get('price'))*100),category:data.get('category'),description:data.get('description'),image:editorImages[0] || '',images:[...editorImages],active:data.has('active'),variants}});
      $('#editor').close(); await refresh(); toast('Product saved.');
    } else if (f.id === 'settings-form') {
      await post('settings',{revision:state.revision,settings:{title:data.get('title'),tagline:data.get('tagline'),contactEmail:data.get('contactEmail'),shippingCents:Math.round(Number(data.get('shipping'))*100),countries:data.getAll('countries'),shippingPolicy:data.get('shippingPolicy'),returnPolicy:data.get('returnPolicy'),checkoutEnabled:data.has('checkoutEnabled')}});
      await refresh(); toast('Settings saved.');
    } else {
      await post('orders/fulfill',{id:f.dataset.id,shipped:data.has('shipped'),tracking:data.get('tracking')}); await refresh(); toast('Fulfillment updated.');
    }
  } catch(err) {
    if (f.id === 'product-form') $('#product-error').textContent = err.message;
    else if (f.id === 'settings-form') $('#settings-error').textContent = err.message;
    else toast(err.message);
  } finally { button.disabled = false; }
});
function handle(err) { if ([401,503].includes(err.status)) login(err.message); else toast(err.message); }
try { await refresh(); } catch(err) { login(err.status === 401 ? '' : err.message); }
