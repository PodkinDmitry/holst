"""CHAT 09 browser gate: two Chromium pages, independent coordinators, fake ATOMIC backend.
Run: xvfb-run -a python cross-tab-browser.py --component <CHAT07 integrated JS>
No internet, storage is intentionally fake. This does NOT prove SOL storage CAS.
"""
import argparse, copy, threading
from pathlib import Path
from playwright.sync_api import sync_playwright

P = argparse.ArgumentParser()
P.add_argument('--component', required=True, help='Path to the CHAT 07 integrated component JS')
args = P.parse_args()
source = Path(args.component).read_text(encoding='utf-8')
coordinator = (Path(__file__).parent/'xod-cas-view-coordinator.js').read_text(encoding='utf-8')

class AtomicBackend:
    def __init__(self): self._lock=threading.Lock(); self.reset()
    def reset(self):
        with self._lock:
            self.doc={'views':{},'presets':[]};self.rev=0;self.collisions=0;self.calls=0;self.fail_after=False
    def read(self):
        with self._lock:return {'revision':self.rev,'data':copy.deepcopy(self.doc)}
    def cas(self, expected, state):
        with self._lock:
            self.calls+=1
            if expected!=self.rev:
                self.collisions+=1
                return {'ok':False}
            self.rev+=1;self.doc=copy.deepcopy(state)
            if self.fail_after:
                self.fail_after=False
                raise RuntimeError('ambiguous network completion after commit')
            return {'ok':True}

backend=AtomicBackend()
fixture='''<html lang="ru"><head><meta charset="utf-8"></head><body><main id="root"></main></body></html>'''
setup='''async ({scope}) => {
window.scope=scope;
window.coordinator=createXodCasViewCoordinator({read:()=>window.backendRead(),compareAndSwap:(v,d)=>window.backendCAS(v,d)});
window.editor=await window.coordinator.openView(scope);
window.cfg={entries:[{id:'v1',type:'video',title:'Video 1',values:{category:'inbox',watched:'no'}}],
  fields:[{key:'category',label:'Категория',types:['video'],options:[{value:'inbox',label:'Входящие'},{value:'favorite',label:'Избранное'}]},
          {key:'watched',label:'Просмотрено',types:['video'],options:[{value:'no',label:'Нет'},{value:'yes',label:'Да'}]}],
  onApply: async ()=>({entries:window.cfg.entries,applied:1,skipped:0,failed:0})};
window.table=mountYoutubeTable300(document.querySelector('#root'), {...window.cfg,view:window.editor.view, onSaveView:window.editor.onSaveView});
return window.editor.revision;
}'''
set_group='''(value)=>{let s=document.querySelector('.yt-table300__grouping-field');if(!s)throw Error('group select missing');s.value=value;s.dispatchEvent(new Event('change',{bubbles:true}));return s.value}'''
saved="document.querySelector('.yt-table300__view-status')?.textContent?.includes('сохранены')"
failed="document.querySelector('.yt-table300__view-status')?.textContent?.includes('Не удалось')"
results=[]
def check(name,condition):
    results.append(bool(condition));print(('PASS' if condition else 'FAIL'), name)
    if not condition:raise AssertionError(name)

with sync_playwright() as pw:
    browser=pw.chromium.launch(headless=True,executable_path='/usr/bin/chromium',args=['--no-sandbox','--disable-dev-shm-usage'])
    context=browser.new_context(viewport={'width':1100,'height':850})
    errors=[]
    context.expose_function('backendRead',backend.read)
    context.expose_function('backendCAS',backend.cas)
    p1,p2=context.new_page(),context.new_page()
    for page in (p1,p2):
        page.on('pageerror',lambda e:errors.append(str(e)))
        page.set_content(fixture)
        page.add_script_tag(content=source)
        page.add_script_tag(content=coordinator)
    # Test different scopes in genuinely separate browser pages (fake shared CAS backend).
    p1.evaluate(setup,{'scope':'main'});p2.evaluate(setup,{'scope':'sidebar'})
    p1.evaluate(set_group,'category');p2.evaluate(set_group,'watched')
    p1.wait_for_function(saved,timeout=10000);p2.wait_for_function(saved,timeout=10000)
    check('01: two browser pages different scope, both persisted',backend.doc['views']['main']['group']['key']=='category' and backend.doc['views']['sidebar']['group']['key']=='watched')
    # Same scope stale conflict must be visible; initial editor B opens before A saves.
    backend.reset()
    for page in (p1,p2):
        page.evaluate('''()=>{window.table.destroy();window.editor.dispose()}''')
        page.evaluate(setup,{'scope':'shared'})
    p1.evaluate(set_group,'category');p1.wait_for_function(saved,timeout=10000)
    p2.evaluate(set_group,'watched');p2.wait_for_function(failed,timeout=10000)
    check('02: same scope stale save rejected and first view intact',backend.doc['views']['shared']['group']['key']=='category' and backend.doc['viewRevisions']['shared']==1)
    check('03: UI retains local unsaved view and surfaces conflict',p2.locator('.yt-table300__grouping-field').input_value()=='watched' and 'другой вкладке' in p2.locator('.yt-table300__view-status').text_content())
    # Explicit user decision: reload current remote version and then apply chosen local edit.
    p2.evaluate('''async()=>{
       let latest=await window.editor.reload();
       window.table.destroy();window.editor.dispose();
       window.editor=await window.coordinator.openView('shared');
       window.table=mountYoutubeTable300(document.querySelector('#root'),{...window.cfg,view:window.editor.view,onSaveView:window.editor.onSaveView});
       return latest.revision;
    }''')
    p2.evaluate(set_group,'watched');p2.wait_for_function(saved,timeout=10000)
    check('04: explicit reload and reapply commits intended edit',backend.doc['views']['shared']['group']['key']=='watched' and backend.doc['viewRevisions']['shared']==2)
    # A preset transaction must coexist with view changes across separate pages.
    backend.reset()
    p1.evaluate('''()=>{window.table.destroy();window.editor.dispose()}''')
    p1.evaluate(setup,{'scope':'main'})
    p1.evaluate('''()=>window.coordinator.transaction(d=>{d.presets=[{id:'p1',name:'Saved'}]})''')
    p1.evaluate(set_group,'category');p1.wait_for_function(saved,timeout=10000)
    check('05: preset and view have independent persisted branches',len(backend.doc['presets'])==1 and backend.doc['views']['main']['group']['key']=='category')
    check('06: no browser JavaScript exceptions',not errors)
    browser.close()
print(f'RESULT {sum(results)}/{len(results)} '+('PASS' if all(results) else 'FAIL'))
