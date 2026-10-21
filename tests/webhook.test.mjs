import test from 'node:test';
import assert from 'node:assert/strict';
import Stripe from 'stripe';
import handler from '../netlify/functions/shop.mjs';

test('webhook rejects invalid signatures and acknowledges unrelated signed events', async () => {
  const keys=['STRIPE_SECRET_KEY','STRIPE_WEBHOOK_SECRET','SITE_URL'];
  const before=Object.fromEntries(keys.map(k=>[k,process.env[k]]));
  // No network calls: the SDK signs/verifies local fixtures with an ephemeral test secret.
  process.env.STRIPE_SECRET_KEY='sk_test_local_fixture_only';
  process.env.STRIPE_WEBHOOK_SECRET='whsec_local_fixture_only';
  process.env.SITE_URL='https://example.com';
  try {
    const payload=JSON.stringify({id:'evt_local_fixture',type:'checkout.session.completed',livemode:false,data:{object:{id:'cs_local_fixture',metadata:{},payment_status:'paid'}}});
    const request=signature=>new Request('https://example.com/api/shop/webhook',{method:'POST',headers:{'stripe-signature':signature},body:payload});
    const invalid=await handler(request('invalid'));
    assert.equal(invalid.status,400); assert.match((await invalid.json()).error,/signature/);
    const client=new Stripe(process.env.STRIPE_SECRET_KEY);
    const signature=client.webhooks.generateTestHeaderString({payload,secret:process.env.STRIPE_WEBHOOK_SECRET});
    const unrelated=await handler(request(signature));assert.equal(unrelated.status,200);assert.deepEqual(await unrelated.json(),{received:true});
    const tampered=await handler(new Request('https://example.com/api/shop/webhook',{method:'POST',headers:{'stripe-signature':signature},body:payload+' '}));assert.equal(tampered.status,400);
  } finally {for(const k of keys){if(before[k]===undefined)delete process.env[k];else process.env[k]=before[k];}}
});
