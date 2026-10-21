import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
// Build metadata isn't guaranteed in a serverless function's runtime env.
// Bake only the non-secret storage namespace into the function bundle.
const scope = process.env.CONTEXT === 'production' ? 'production' :
  (process.env.DEPLOY_ID ?? 'local').replace(/[^a-zA-Z0-9-]/g, '').slice(0,25);
writeFileSync('lib/deployment.mjs', '// Generated non-secret deployment scope.\nexport const STORAGE_SCOPE = ' + JSON.stringify(scope) + ';\n');
function walk(dir) { return readdirSync(dir).flatMap(n => { const p=join(dir,n); return statSync(p).isDirectory()?walk(p):[p]; }); }
for (const dir of ['lib','netlify/functions','public/shop','scripts']) {
  for (const path of walk(dir).filter(p => /\.(mjs|js)$/.test(p))) execFileSync(process.execPath,['--check',path],{stdio:'inherit'});
}
for (const path of ['public/index.html','public/profile.png','public/shop/index.html','public/shop/admin/index.html']) {
  if (!readFileSync(path).length) throw new Error(`Missing required file: ${path}`);
}
console.log('JavaScript syntax and required site files verified.');
