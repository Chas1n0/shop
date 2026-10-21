// Local-only smoke test against Netlify Dev and its real local Blobs service.
// Run after creating ignored .env test credentials; never use production secrets.
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
const child = spawn('node_modules/.bin/netlify',['dev','--offline','--no-open','--port','8888','--dir','public','--framework','#static'],{stdio:['ignore','pipe','pipe'],detached:true});
let logs=''; for(const stream of [child.stdout,child.stderr]) stream.on('data',d=>{logs+=d.toString();if(d.toString().includes('ready:'))console.log('Local Netlify server started.');});
const base='http://localhost:8888';
const password=readFileSync('/tmp/chase-shop-test-password','utf8');
let cookie='';
async function request(path,body,expected=200,withCookie=true,origin=base) {
  const r=await fetch(base+'/api/shop/'+path,{signal:AbortSignal.timeout(10000),method:body===undefined?'GET':'POST',headers:{...(body!==undefined?{'Content-Type':'application/json',Origin:origin}:{}),...(withCookie&&cookie?{Cookie:cookie}:{})},body:body===undefined?undefined:JSON.stringify(body)});
  let data;try{data=await r.json();}catch{throw new Error(`Non-JSON response at ${path}: ${r.status}`);}
  assert.equal(r.status,expected,`${path}: ${JSON.stringify(data)}`);
  if(r.headers.get('set-cookie'))cookie=r.headers.get('set-cookie').split(';')[0];
  return data;
}
try {
  let ready=false;
  for(let i=0;i<30;i++){try{const r=await fetch(base+'/api/shop/catalog',{signal:AbortSignal.timeout(2000)});if(r.status===200){ready=true;break;}}catch{}await new Promise(r=>setTimeout(r,500));}
  assert.ok(ready,'Netlify Dev did not become ready. '+logs.slice(-2000));
  assert.equal((await fetch(base+'/shop/')).status,200);
  assert.equal((await fetch(base+'/shop/admin/')).status,200);
  await request('admin',undefined,401,false);
  await request('login',{email:'local-test@example.com',password:'wrong'},401,false);
  await request('login',{email:'local-test@example.com',password},200,false);
  assert.match(cookie,/__Host-chase-manager=/);
  let s=await request('admin');
  const p={title:'Integration test tee',priceCents:2500,active:false,category:'Tees',description:'Local test',image:'',variants:[{size:'M',color:'Black',stock:2}]};
  const result=await request('products',{revision:s.revision,product:p});
  assert.ok(result.product.id);
  assert.equal((await request('catalog')).products.some(p=>p.id===result.product.id),false);
  s=await request('admin');
  await request('products',{revision:s.revision,product:{...result.product,active:true}},200);
  assert.equal((await request('catalog')).products.some(p=>p.id===result.product.id),true);
  await request('products',{revision:s.revision,product:{...result.product,title:'Stale edit'}},409);
  await request('settings',{revision:s.revision,settings:s.settings},403,true,'https://evil.example');
  s=await request('admin');
  await request('settings',{revision:s.revision,settings:{...s.settings,checkoutEnabled:true}},400);
  await request('orders/fulfill',{id:'missing',shipped:true},400);
  await request('checkout',{items:[]},503,false);
  const image=await fetch(base+'/api/shop/upload',{method:'POST',headers:{Origin:base,Cookie:cookie,'Content-Type':'image/png'},body:Buffer.from('89504e470d0a1a0a00000000','hex')});
  assert.equal(image.status,200);const imageData=await image.json();
  const downloaded=await fetch(base+imageData.image);assert.equal(downloaded.headers.get('content-type'),'image/png');
  const badImage=await fetch(base+'/api/shop/upload',{method:'POST',headers:{Origin:base,Cookie:cookie},body:'<svg>bad image</svg>'});assert.equal(badImage.status,400);
  await request('logout',{});
  await request('admin',undefined,401);
  console.log('PASS: Netlify pages, real local Blobs, login/logout, private admin, product CRUD, public catalog, stale-write protection, CSRF, disabled checkout, fulfillment guard, image upload/read, and unsafe-image rejection.');
} catch(error){console.error(error.message);process.exitCode=1;}
finally{try{process.kill(-child.pid,'SIGTERM');}catch{child.kill();}}
