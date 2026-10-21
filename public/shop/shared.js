export const $ = (s, root = document) => root.querySelector(s);
export const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export const cash = cents => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(cents / 100);
export async function api(path, options = {}) {
  const result = await fetch(`/api/shop/${path}`, { credentials: 'same-origin', ...options });
  let data;
  try { data = await result.json(); } catch { throw new Error('The shop could not connect. Please try again.'); }
  if (!result.ok) { const e = new Error(data.error || 'Request failed.'); e.status = result.status; throw e; }
  return data;
}
export const post = (path, data) => api(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
let toastTimer;
export function toast(message) { const el = $('#toast'); el.textContent = message; el.hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => el.hidden = true, 6000); }
export const hanger = '<svg viewBox="0 0 80 80" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><path d="M34 23a7 7 0 1 1 10 6l-4 3v5L12 54q-6 5 2 7h52q8-2 2-7L40 37"/></svg>';
export function dialogs() {
  document.addEventListener('click', e => { const close = e.target.closest('[data-close]'); if (close) close.closest('dialog').close(); });
  for (const d of document.querySelectorAll('dialog')) d.addEventListener('click', e => { if (e.target === d) { const r = d.getBoundingClientRect(); if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) d.close(); } });
}
