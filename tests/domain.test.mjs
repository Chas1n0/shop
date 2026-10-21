import test from 'node:test';
import assert from 'node:assert/strict';
import { initialState, validateProduct, validateSettings, reserveOrder, releaseOrder, applyPayment } from '../lib/domain.mjs';
import { mutateState } from '../lib/storage.mjs';
import { scryptSync } from 'node:crypto';
import { verifyPassword, sameOrigin } from '../lib/auth.mjs';

function fixture(stock = 2) {
  const s = initialState();
  s.products.push(validateProduct({title:'Tee',priceCents:2500,active:true,image:'',variants:[{size:'M',color:'Black',stock}]}));
  const p = s.products[0];
  return {s,p,cart:[{productId:p.id,variantId:p.variants[0].id,quantity:1}]};
}
const paidSession = o => ({id:'cs_test_1',metadata:{order_id:o.id},payment_status:'paid',currency:'usd',amount_total:o.total,livemode:false,customer_details:{name:'Test Buyer',email:'test@example.com',address:{country:'US'}},collected_information:{shipping_details:{name:'Test Buyer',address:{line1:'123 Test St',country:'US'}}}});
test('server price is authoritative and duplicate bag rows cannot oversell',()=>{
  const {s,p,cart}=fixture(1); cart[0].priceCents=1;
  const o=reserveOrder(s,cart); assert.equal(o.total,2500); assert.equal(p.variants[0].stock,0);
  assert.throws(()=>reserveOrder(s,cart),/Not enough stock/);
  const f=fixture(1); assert.throws(()=>reserveOrder(f.s,[...f.cart,...f.cart]),/Not enough stock/); assert.equal(f.p.variants[0].stock,1);
});
test('all bag lines are validated before changing inventory',()=>{
  const {s,p,cart}=fixture(); assert.throws(()=>reserveOrder(s,[...cart,{productId:'missing',variantId:'x',quantity:1}]),/no longer available/); assert.equal(p.variants[0].stock,2);
});
test('expiration releases once and never releases a paid order',()=>{
  const {s,p,cart}=fixture(); const o=reserveOrder(s,cart);
  assert.equal(releaseOrder(s,o.id),true); assert.equal(releaseOrder(s,o.id),false); assert.equal(p.variants[0].stock,2);
  const next=reserveOrder(s,cart); applyPayment(s,paidSession(next)); assert.equal(releaseOrder(s,next.id),false); assert.equal(p.variants[0].stock,1);
});
test('payment is idempotent, validates amount and shipping, and ignores unpaid completion',()=>{
  const {s,p,cart}=fixture(); const o=reserveOrder(s,cart); const session=paidSession(o);
  assert.equal(applyPayment(s,{...session,payment_status:'unpaid'}),false); assert.equal(o.status,'pending');
  assert.throws(()=>applyPayment(s,{...session,amount_total:1}),/total mismatch/);
  assert.throws(()=>applyPayment(s,{...session,collected_information:{}}),/address missing/);
  assert.equal(applyPayment(s,session),true); assert.equal(applyPayment(s,session),false);
  assert.equal(o.customer.shipping.address.line1,'123 Test St'); assert.equal(p.variants[0].stock,1);
});
test('product validation rejects unsafe URLs and invalid or duplicate inventory',()=>{
  const {p}=fixture(); assert.throws(()=>validateProduct({...p,image:'javascript:alert(1)'}),/HTTPS/);
  assert.throws(()=>validateProduct({...p,variants:[{size:'M',color:'Black',stock:-1}]}),/Stock/);
  assert.throws(()=>validateProduct({...p,variants:[...p.variants,...p.variants]}),/unique/);
  assert.throws(()=>validateProduct({...p,priceCents:NaN}),/price/);
});
test('checkout cannot be enabled without policies and support contact',()=>{
  const s=initialState().settings;
  assert.throws(()=>validateSettings({...s,checkoutEnabled:true},s),/policy/);
  assert.equal(validateSettings({...s,checkoutEnabled:true,contactEmail:'shop@example.com',shippingPolicy:'Ships in 2 days',returnPolicy:'Returns in 14 days'},s).checkoutEnabled,true);
});
test('optimistic writes retry collisions without losing an order or overselling',async()=>{
  const {s,p,cart}=fixture(1); let data=s,etag=1;
  const backend={async getWithMetadata(){return {data:structuredClone(data),etag:String(etag)};},async setJSON(k,next,opts){await new Promise(r=>setImmediate(r));if(opts.onlyIfMatch!==String(etag))return {modified:false};data=structuredClone(next);etag++;return {modified:true,etag:String(etag)};}};
  const results=await Promise.allSettled([mutateState(s=>reserveOrder(s,cart),backend),mutateState(s=>reserveOrder(s,cart),backend)]);
  assert.equal(results.filter(r=>r.status==='fulfilled').length,1); assert.equal(Object.keys(data.orders).length,1); assert.equal(data.products[0].variants[0].stock,0);
});
test('passwords are verified against scrypt hashes; admin writes require same origin',()=>{
  const salt='12'.repeat(16),hash=`scrypt:${salt}:${scryptSync('correct-password',salt,64).toString('hex')}`;
  assert.equal(verifyPassword('correct-password',hash),true); assert.equal(verifyPassword('wrong-password',hash),false);
  assert.throws(()=>sameOrigin(new Request('https://example.com/api/shop/settings',{method:'POST',headers:{origin:'https://evil.com'}})),/origin rejected/);
  sameOrigin(new Request('https://example.com/api/shop/settings',{method:'POST',headers:{origin:'https://example.com'}}));
});
