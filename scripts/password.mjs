import { scryptSync, randomBytes } from 'node:crypto';
import { Writable } from 'node:stream';
import readline from 'node:readline';
if (!process.stdin.isTTY) { console.error('Run this command in an interactive terminal.'); process.exit(1); }
let muted = false;
const output = new Writable({ write(chunk, encoding, done) { if (!muted) process.stdout.write(chunk, encoding); done(); } });
const rl = readline.createInterface({ input: process.stdin, output, terminal: true });
process.stdout.write('Choose a manager password (at least 14 characters; input hidden): ');
muted = true;
rl.question('', password => {
  rl.close(); process.stdout.write('\n');
  if (password.length < 14 || password.length > 256) { console.error('Use 14–256 characters.'); process.exitCode = 1; return; }
  const salt = randomBytes(16).toString('hex');
  console.log('MANAGER_PASSWORD_HASH=scrypt:' + salt + ':' + scryptSync(password, salt, 64).toString('hex'));
  console.log('SESSION_SECRET=' + randomBytes(32).toString('hex'));
  console.log('Save these values in Netlify, not in GitHub.');
});
