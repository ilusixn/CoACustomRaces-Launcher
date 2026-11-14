const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const vm = require('node:vm');
const { Portal } = require('../src/portal.cjs');
const { GameCredentials } = require('../src/game-credentials.cjs');
const { ClientUpdater } = require('../src/client-updater.cjs');

test('Remember me restores a saved cookie, while session-only login removes it and renewal never saves it', async t => {
  const folder = await fs.mkdtemp(path.join(os.tmpdir(), 'coa-remember-')); t.after(() => fs.rm(folder, { recursive: true, force: true }));
  const file = path.join(folder, 'session');
  const options = { cookieName: 'coa_launcher', sessionFile: file, encrypt: text => Buffer.from(text), decrypt: data => data.toString(), fetchImpl: async url => Response.json(url.pathname === '/api/auth/session' ? { username: 'PLAYER' } : {}, { headers: { 'Set-Cookie': 'coa_launcher=remembered' } }) };
  const first = new Portal('https://launcher.example/', options);
  await first.login('player', 'password');
  const restored = new Portal('https://launcher.example/', options); await restored.load(); assert.equal(restored.cookie, 'coa_launcher=remembered');
  await restored.login('player', 'password', { rememberSession: false }); await restored.account();
  await assert.rejects(fs.stat(file), { code: 'ENOENT' }); assert.equal(restored.cookie, 'coa_launcher=remembered');
});

test('game credentials survive a restart encrypted, cannot cross account identities, and are removed on opt-out', async t => {
  const folder = await fs.mkdtemp(path.join(os.tmpdir(), 'coa-game-vault-')); t.after(() => fs.rm(folder, { recursive: true, force: true }));
  const file = path.join(folder, 'vault'); const key = crypto.randomBytes(32);
  const encrypt = text => { const iv=crypto.randomBytes(12), c=crypto.createCipheriv('aes-256-gcm',key,iv); const data=Buffer.concat([c.update(text,'utf8'),c.final()]); return Buffer.concat([iv,c.getAuthTag(),data]); };
  const decrypt = data => { const c=crypto.createDecipheriv('aes-256-gcm',key,data.subarray(0,12));c.setAuthTag(data.subarray(12,28));return Buffer.concat([c.update(data.subarray(28)),c.final()]).toString(); };
  const vault = new GameCredentials(file,encrypt,decrypt); await vault.write({ username:'PLAYER', password:'test-secret' });
  assert.equal((await fs.readFile(file)).includes(Buffer.from('test-secret')),false);
  const reopened = new GameCredentials(file,encrypt,decrypt); assert.equal((await reopened.read('PLAYER')).password,'test-secret');assert.equal(await reopened.read('OTHER'),null);
  await reopened.write(null);assert.equal(await reopened.read('PLAYER'),null);
  const unavailable = new GameCredentials(file,()=>{throw Error('unavailable');},decrypt);
  await assert.rejects(unavailable.write({username:'PLAYER',password:'test-secret'}), /could not be saved securely/);await assert.rejects(fs.stat(file),{code:'ENOENT'});
});

test('outdated version failures never fall back to an offline cached release', async () => {
  const headers=[];
  const updater = new ClientUpdater('https://downloads.example/downloads/client/latest.json', { launcherVersion:'0.8.0',fetchImpl:async (_url,init)=>{ headers.push(init.headers);return Response.json({message:'Update required'}, {status:426}); } });
  let cacheReads=0;updater.readState=async()=>{cacheReads++;return {};};
  await assert.rejects(updater.check('C:\\Game',false,true), /Update your launcher/);assert.equal(cacheReads,0);assert.equal(headers[0]['X-CoA-Launcher-Version'],'0.8.0');
});

test('object downloads send the required version and a rejected version neither retries nor overwrites the partial', async t => {
  const folder = await fs.mkdtemp(path.join(os.tmpdir(), 'coa-version-object-')); t.after(() => fs.rm(folder, { recursive: true, force: true }));
  const data = Buffer.from('verified client bytes'), hash=crypto.createHash('sha256').update(data).digest('hex');
  let requests=0; const updater=new ClientUpdater('https://downloads.example/downloads/client/latest.json',{launcherVersion:'0.8.1',fetchImpl:async(_url,init)=>{requests++;assert.equal(init.headers['X-CoA-Launcher-Version'],'0.8.1');return new Response(data);}});
  const file={path:'Ascension.exe',size:data.length,sha256:hash};
  const target=await updater.download(folder,file,new AbortController().signal,()=>{});assert.deepEqual(await fs.readFile(target),data);
  await fs.writeFile(target,data.subarray(0,4));requests=0;
  updater.fetch=async()=>{requests++;return new Response('update required',{status:426});};
  await assert.rejects(updater.download(folder,file,new AbortController().signal,()=>{}),/Update your launcher/);
  assert.equal(requests,1);assert.deepEqual(await fs.readFile(target),data.subarray(0,4));
});
