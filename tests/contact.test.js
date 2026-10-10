const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createHandler } = require('../api/contact');
const env = { CONTACT_ENABLED: 'true', RESEND_API_KEY: 'test-key', CONTACT_FROM: 'forms@example.com', CONTACT_TO: 'owner@example.com', CONTACT_ALLOWED_ORIGINS: 'https://example.com', TURNSTILE_SITE_KEY: 'public-test-sitekey', TURNSTILE_SECRET_KEY: 'test-secret' };
const body = { name: 'Test Person', email: 'visitor@example.org', company: '', needs: 'A synthetic project inquiry for testing.', website: '', token: 'valid-token', requestId: 'dbe006a5-6a31-46c5-a356-3214849c31f7' };
async function run({ method = 'POST', data = body, headers = {}, settings = env, fetchImpl, limit = () => false } = {}) {
  const calls = [];
  const fetcher = fetchImpl || (async (url, options) => {
    calls.push({ url, ...options });
    return { ok: true, json: async () => url.includes('siteverify') ? { success: true, hostname: 'example.com', action: 'contact' } : { id: 'synthetic-id' } };
  });
  const req = { method, body: data, headers: { origin: 'https://example.com', 'content-type': 'application/json', ...headers }, socket: { remoteAddress: '127.0.0.1' } };
  const res = { headers: {}, setHeader(k,v) { this.headers[k]=v; }, status(code) { this.code=code; return this; }, json(data) { this.data=data; } };
  await createHandler({ env: settings, fetchImpl: fetcher, limit })(req,res);
  return { ...res, calls };
}
test('routes privately to configured inbox; visitor is reply-to only, plain text and stable idempotency', async () => {
  const first = await run(); const second = await run();
  assert.equal(first.code,200); assert.equal(first.calls.length,2);
  const payload=JSON.parse(first.calls[1].body);
  assert.deepEqual(payload.to,['owner@example.com']);assert.equal(payload.from,'forms@example.com');assert.equal(payload.reply_to,body.email);assert.equal(payload.html,undefined);
  assert.equal(first.calls[1].headers['Idempotency-Key'],second.calls[1].headers['Idempotency-Key']);
  assert.ok(!JSON.stringify(first.data).includes('owner@example.com'));
});
test('public config exposes only site key; disabled/missing configuration fails closed', async () => {
  assert.deepEqual((await run({method:'GET'})).data,{siteKey:env.TURNSTILE_SITE_KEY});
  for(const key of Object.keys(env)) {const result=await run({settings:{...env,[key]:''}});assert.ok([403,503].includes(result.code));assert.equal(result.calls.length,0);}
});
test('rejects cross origin, missing origin, method, format, malformed and oversized requests', async () => {
  for(const options of [{headers:{origin:'https://evil.example'}},{headers:{origin:''}},{method:'DELETE'},{headers:{'content-type':'text/plain'}},{data:'{'},{data:[]},{data:{...body,needs:'x'.repeat(17000)}},{headers:{'content-length':'17000'}}]) {
    const result=await run(options);assert.ok(result.code>=400);assert.equal(result.calls.length,0);
  }
});
test('validates name, email, company, message and blocks header injection', async () => {
  for(const data of [{...body,name:''},{...body,name:'x'.repeat(101)},{...body,email:'bad'},{...body,email:'visitor@example.org\r\nBcc: victim@example.org'},{...body,company:'x'.repeat(151)},{...body,needs:'short'},{...body,needs:'x'.repeat(5001)}]) {
    const result=await run({data});assert.equal(result.code,422);assert.equal(result.calls.length,0);assert.ok(result.data.errors);
  }
});
test('honeypot, missing token, malformed request ID and rate limit prevent send', async () => {
  for(const data of [{...body,website:'spam'},{...body,token:''},{...body,requestId:'bad'}]) {const r=await run({data});assert.equal(r.code,400);assert.equal(r.calls.length,0);}
  const r=await run({limit:()=>true});assert.equal(r.code,429);assert.equal(r.headers['Retry-After'],'600');
});
test('Turnstile failure, replay, wrong action/host or outage never reaches mail', async () => {
  for(const result of [{success:false,'error-codes':['timeout-or-duplicate']},{success:true,action:'other',hostname:'example.com'},{success:true,action:'contact',hostname:'evil.example'}]) {
    let count=0;const r=await run({fetchImpl:async()=>{count++;return {ok:true,json:async()=>result};}});assert.equal(r.code,400);assert.equal(count,1);
  }
  const outage=await run({fetchImpl:async()=>{throw Error('secret provider diagnostic');}});assert.equal(outage.code,503);assert.ok(!JSON.stringify(outage.data).includes('secret'));
});
test('mail rejection, timeout and missing acknowledgement return honest error without leaking provider data', async () => {
  for(const mode of ['reject','timeout','no-id']) {
    const r=await run({fetchImpl:async url=>{
      if(url.includes('siteverify'))return {ok:true,json:async()=>({success:true,hostname:'example.com',action:'contact'})};
      if(mode==='timeout')throw Error('timeout');return {ok:mode!=='reject',json:async()=>({message:'private provider detail'})};
    }});assert.equal(r.code,503);assert.ok(!JSON.stringify(r.data).includes('private provider'));
  }
});
test('actual throttle isolates visitors and resets after ten minutes', () => {
  const { rateLimited }=require('../api/contact');
  for(let i=0;i<5;i++)assert.equal(rateLimited('visitor-one',1000),false);
  assert.equal(rateLimited('visitor-one',1001),true);
  assert.equal(rateLimited('visitor-two',1001),false);
  assert.equal(rateLimited('visitor-one',601001),false);
});
