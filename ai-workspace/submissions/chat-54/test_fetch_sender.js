// Node VM executing the exact ext224/background.js xfetch/kbfetch authorization code.
// node test_fetch_sender.js /path/to/ext224/background.js
const fs=require('node:fs'), vm=require('node:vm'), assert=require('node:assert/strict');
const code=fs.readFileSync(process.argv[2],'utf8');
const a=code.indexOf('/* v2.13: a request for the Холст page');
const b=code.indexOf('/* ---------- v2.20: working with Холст closed ---------- */',a);
if(a<0||b<=a)throw Error('Unsupported background.js fetch source shape');
const helper=code.includes('function trustedHolstSender224(')?code.slice(code.indexOf('/* Verify the actual sending frame URL'),a):'';
const implementation=helper+code.slice(a,b);
function harness(base='https://podkindmitry.github.io/holst/'){
  const requests=[];
  const fetch=async(url,init)=>{requests.push({url,init});return{ok:true,status:200,statusText:'OK',headers:{forEach:fn=>fn('text/plain','content-type'),get:()=>'text/plain'},text:async()=> 'page',arrayBuffer:async()=>new Uint8Array([1,2]).buffer}};
  const context={fetch,holstUrl:async()=>base,URL,Uint8Array,btoa:x=>Buffer.from(x,'binary').toString('base64'),String,Promise};
  vm.createContext(context);
  vm.runInContext(implementation+'\nglobalThis.api={xfetch,kbfetch};',context,{filename:'ext224/background.js/fetch-sender'});
  const sender=(tabUrl,frameUrl)=>frameUrl===undefined?{tab:{url:tabUrl}}:{tab:{url:tabUrl},url:frameUrl};
  const invoke=(op,from,{url,method='GET',frameUrl}={})=>context.api[op]({url:url||(op==='xfetch'?'https://api.anthropic.com/v1/messages':'https://example.org/article'),init:{method}},sender(from,frameUrl));
  return {requests,invoke};
}
const base='https://podkindmitry.github.io/holst/';
const cases=[
 ['xfetch rejects localhost-lookalike domain',async()=>{const h=harness();const r=await h.invoke('xfetch','http://localhost.attacker.example/steal');assert.equal(r.ok,false);assert.equal(h.requests.length,0)}],
 ['kbfetch rejects localhost-lookalike domain',async()=>{const h=harness();const r=await h.invoke('kbfetch','http://localhost.attacker.example/steal');assert.equal(r.ok,false);assert.equal(h.requests.length,0)}],
 ['xfetch rejects localhost credentials trick',async()=>{const h=harness();const r=await h.invoke('xfetch','http://localhost@evil.example/a');assert.equal(r.ok,false);assert.equal(h.requests.length,0)}],
 ['kbfetch rejects localhost subdomain',async()=>{const h=harness();const r=await h.invoke('kbfetch','http://localhost.evil.test/');assert.equal(r.ok,false);assert.equal(h.requests.length,0)}],
 ['xfetch rejects sibling custom configured path',async()=>{const h=harness('https://example.org/holst');const r=await h.invoke('xfetch','https://example.org/holstery/');assert.equal(r.ok,false);assert.equal(h.requests.length,0)}],
 ['kbfetch rejects sibling custom configured path',async()=>{const h=harness('https://example.org/holst');const r=await h.invoke('kbfetch','https://example.org/holst-not-myapp/');assert.equal(r.ok,false);assert.equal(h.requests.length,0)}],
 ['xfetch rejects iframe sender from another origin',async()=>{const h=harness();const r=await h.invoke('xfetch',base,{frameUrl:'https://evil.example/frame'});assert.equal(r.ok,false);assert.equal(h.requests.length,0)}],
 ['kbfetch rejects iframe sender from another origin',async()=>{const h=harness();const r=await h.invoke('kbfetch',base,{frameUrl:'https://evil.example/frame'});assert.equal(r.ok,false);assert.equal(h.requests.length,0)}],
 ['xfetch accepts configured root with omitted slash',async()=>{const h=harness();const r=await h.invoke('xfetch','https://podkindmitry.github.io/holst');assert.equal(r.ok,true);assert.equal(h.requests.length,1)}],
 ['kbfetch allows trusted loopback IP',async()=>{const h=harness();const r=await h.invoke('kbfetch','http://127.0.0.1:8000/editor');assert.equal(r.ok,true);assert.equal(h.requests.length,1)}],
 ['xfetch allows trusted ipv6 loopback',async()=>{const h=harness();const r=await h.invoke('xfetch','http://[::1]:8080/');assert.equal(r.ok,true);assert.equal(h.requests.length,1)}],
 ['xfetch rejects invalid sending URL',async()=>{const h=harness();const r=await h.invoke('xfetch','not a valid URL');assert.equal(r.ok,false);assert.equal(h.requests.length,0)}],
 ['kbfetch rejects untrusted https page',async()=>{const h=harness();const r=await h.invoke('kbfetch','https://example.org/');assert.equal(r.ok,false);assert.equal(h.requests.length,0)}],
 ['xfetch valid Holst path allows known AI API',async()=>{const h=harness();const r=await h.invoke('xfetch',base+'board/1');assert.equal(r.ok,true);assert.equal(h.requests[0].url,'https://api.anthropic.com/v1/messages')}],
 ['kbfetch valid Holst path allows article GET',async()=>{const h=harness();const r=await h.invoke('kbfetch',base+'?panel=1');assert.equal(r.ok,true);assert.equal(h.requests[0].init.method,'GET')}],
 ['kbfetch valid local hostname allows article GET',async()=>{const h=harness();const r=await h.invoke('kbfetch','http://localhost:5173/edit');assert.equal(r.ok,true)}],
 ['xfetch rejects non-allowlisted API destination',async()=>{const h=harness();const r=await h.invoke('xfetch',base,{url:'https://unknown.example/private'});assert.equal(r.ok,false);assert.equal(h.requests.length,0)}],
 ['kbfetch rejects non-GET body on article',async()=>{const h=harness();const r=await h.invoke('kbfetch',base,{url:'https://example.org/article',method:'POST'});assert.equal(r.ok,false);assert.equal(h.requests.length,0)}],
 ['kbfetch permits YouTube transcript POST',async()=>{const h=harness();const r=await h.invoke('kbfetch',base,{url:'https://www.youtube.com/youtubei/v1/get_transcript',method:'POST'});assert.equal(r.ok,true);assert.equal(h.requests.length,1)}],
 ['xfetch honors custom configured origin descendants',async()=>{const h=harness('https://custom.example/xod-app');const r=await h.invoke('xfetch','https://custom.example/xod-app/board/1');assert.equal(r.ok,true);assert.equal(h.requests.length,1)}],
];
(async()=>{const results=[];for(const [name,fn] of cases){try{await fn();results.push({name,status:'PASS'})}catch(e){results.push({name,status:'FAIL',reason:String(e&&e.message||e).slice(0,170)})}}const passed=results.filter(x=>x.status==='PASS').length;console.log(JSON.stringify({passed,total:results.length,results},null,2));process.exitCode=passed===results.length?0:1;})().catch(e=>{console.error(e);process.exitCode=2});
