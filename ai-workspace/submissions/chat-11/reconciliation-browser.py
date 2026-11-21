"""CHAT 11 actual Chromium UI with separate pages and a simulated atomic CAS backend.
Requires the local CHAT10 component, Chromium/Playwright. No SOL-storage guarantee.
"""
import argparse, copy, threading
from pathlib import Path
from playwright.sync_api import sync_playwright

arg=argparse.ArgumentParser()
arg.add_argument('--component', required=True, help='Path to current integrated XOD YouTube table JS')
arg.add_argument('--css', help='Optional path to CHAT 04 YouTube table CSS')
args=arg.parse_args()
base=Path(__file__).resolve().parent
def sibling(package, filename):
 for path in (base.parent/package/filename, base.parent/('xod-'+package.replace('chat-','chat'))/filename):
  if path.is_file():return path
 raise FileNotFoundError('Missing package '+package+'/'+filename+'; provide a complete workspace checkout')
source=Path(args.component).read_text(encoding='utf-8')
coordinator=(base/'xod-cas-view-coordinator.js').read_text(encoding='utf-8')
css=Path(args.css).read_text(encoding='utf-8') if args.css else sibling('chat-04','xod-youtube-table300.css').read_text(encoding='utf-8')

class AtomicStore:
 def __init__(self):self.guard=threading.RLock();self.reset()
 def reset(self):
  with self.guard:self.data={'views':{},'presets':[]};self.rev=0;self.writes=0;self.mode=None;self.late=[]
 def read(self):
  with self.guard:return {'revision':self.rev,'data':copy.deepcopy(self.data)}
 def cas(self, expected, payload):
  with self.guard:
   mode=self.mode;self.mode=None
   if mode=='precommit':raise RuntimeError('ACK_PRECOMMIT')
   if mode=='late':
    self.late.append((expected, copy.deepcopy(payload)))
    raise RuntimeError('ACK_LATE')
   if expected!=self.rev:return {'ok':False}
   self.data=copy.deepcopy(payload);self.rev+=1;self.writes+=1
   if mode=='lost':raise RuntimeError('ACK_LOST')
   return {'ok':True}
 def commit_late(self):
  with self.guard:
   expected,payload=self.late.pop(0)
   if expected==self.rev:
    self.data=copy.deepcopy(payload);self.rev+=1;self.writes+=1;return True
   return False

store=AtomicStore(); results=[]; errors=[]
def check(label, ok):
 results.append(bool(ok));print(('PASS' if ok else 'FAIL'),label)
 if not ok: raise AssertionError(label)
setup='''async ({scope}) => {
window.scope=scope;
window.coordinator=createXodCasViewCoordinator({read:()=>window.backendRead(),compareAndSwap:(r,d)=>window.backendCAS(r,d)});
window.editor=await window.coordinator.openView(scope);
window.cfg={entries:[{id:'v1',type:'video',title:'Video 1',values:{category:'inbox',watched:'no'}}],
 fields:[{key:'category',label:'Category',types:['video'],options:[{value:'inbox',label:'Inbox'},{value:'favorite',label:'Favorite'}]},
 {key:'watched',label:'Watched',types:['video'],options:[{value:'no',label:'No'},{value:'yes',label:'Yes'}]}],
 onApply: async()=>({entries:window.cfg.entries,applied:1,skipped:0,failed:0})};
window.hostSaveView=async v=>{
 try{return await window.editor.onSaveView(v)}
 catch(err){
  // A host may reconcile the *observed* commit automatically, without redoing CAS.
  if(String(err.message||err).includes('ACK_')||err.code==='XOD_UNKNOWN_COMMIT'){
   const state=await window.editor.reconcile();
   window.lastRecovery=state;
   if(state.status==='observed')return;
  }
  throw err;
 }
};
window.table=mountYoutubeTable300(document.querySelector('#root'),{...window.cfg,view:window.editor.view,onSaveView:window.hostSaveView});
return window.editor.revision;
}'''
set_group='''(value)=>{const s=document.querySelector('.yt-table300__grouping-field');if(!s)throw Error('group selector missing');s.value=value;s.dispatchEvent(new Event('change',{bubbles:true}));return s.value}'''
saved="document.querySelector('.yt-table300__view-status')?.textContent?.includes('сохранены')"
failed="document.querySelector('.yt-table300__view-status')?.textContent?.includes('Не удалось')"
fixture='<html><head><meta charset="utf-8"><style>'+css+'</style></head><body><main id="root"></main></body></html>'
with sync_playwright() as pw:
 browser=pw.chromium.launch(headless=True,executable_path='/usr/bin/chromium',args=['--no-sandbox','--disable-dev-shm-usage'])
 ctx=browser.new_context(viewport={'width':1100,'height':850});ctx.expose_function('backendRead',store.read);ctx.expose_function('backendCAS',store.cas)
 def page(scope):
  p=ctx.new_page();p.on('pageerror',lambda e:errors.append(str(e)));p.set_content(fixture)
  p.add_script_tag(content=source);p.add_script_tag(content=coordinator);p.evaluate(setup,{'scope':scope});return p
 # 01: lost ACK from actual successful commit is observed without a duplicate request.
 p1=page('main');store.mode='lost';p1.evaluate(set_group,'category');p1.wait_for_function(saved,timeout=10000)
 check('01 lost ACK reconciles to saved status in mounted UI',p1.evaluate('window.lastRecovery?.status')=='observed' and store.writes==1 and store.data['views']['main']['group']['key']=='category')
 p1.evaluate(set_group,'watched');p1.wait_for_function(saved,timeout=10000)
 check('02 subsequent UI edit succeeds after observed commit',store.data['viewRevisions']['main']==2 and store.data['views']['main']['group']['key']=='watched')
 p1.close();store.reset()
 # 03: two tabs with stale same-scope edit still conflict and preserve both local/remote intents.
 p1=page('shared');p2=page('shared');p1.evaluate(set_group,'category');p1.wait_for_function(saved)
 p2.evaluate(set_group,'watched');p2.wait_for_function(failed)
 check('03 cross-tab stale conflict shows error; local edit remains visible',store.data['views']['shared']['group']['key']=='category' and p2.locator('.yt-table300__grouping-field').input_value()=='watched' and 'другой вкладке' in p2.locator('.yt-table300__view-status').text_content())
 p1.close();p2.close();store.reset()
 # 04: unknown outcome without visible commit may not be replayed using the existing Retry button.
 p3=page('main');store.mode='precommit';p3.evaluate(set_group,'category');p3.wait_for_function(failed)
 first=p3.evaluate('window.lastRecovery?.status');p3.evaluate("document.querySelector('.yt-table300__view-retry').click()");p3.wait_for_function("document.querySelector('.yt-table300__view-status')?.textContent?.includes('Предыдущее сохранение')")
 check('04 unresolved unknown blocks retry without a new CAS write',first=='unconfirmed' and store.writes==0 and 'Предыдущее сохранение' in p3.locator('.yt-table300__view-status').text_content())
 p3.close();store.reset()
 # 05: late commit initially unknown but confirmed later through reconciliation.
 p4=page('main');store.mode='late';p4.evaluate(set_group,'category');p4.wait_for_function(failed)
 check('05 initial late-commit status is unconfirmed',p4.evaluate('window.lastRecovery?.status')=='unconfirmed' and store.writes==0)
 store.commit_late();outcome=p4.evaluate('()=>window.editor.reconcile()')
 check('06 later reconciliation observes exact committed view without replay',outcome['status']=='observed' and store.writes==1 and store.data['views']['main']['group']['key']=='category')
 p4.close()
 check('07 no unhandled Chromium JS exceptions',not errors)
 browser.close()
print(f'RESULT {sum(results)}/{len(results)} '+('PASS' if all(results) else 'FAIL'))
