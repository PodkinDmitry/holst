#!/usr/bin/env python3
"""CHAT 12: real Chromium DOM with two independent script runtimes, shared atomic fake backend."""
import asyncio, copy, json
from pathlib import Path
from playwright.async_api import async_playwright

HERE=Path(__file__).resolve().parent
JS=(HERE/'xod-versioned-preset-sessions.js').read_text()
HTML='''<!doctype html><html lang="ru"><head><meta charset="utf-8"></head><body>
<h1>CHAT 12: независимый редактор пресетов</h1>
<label>Имя <input id="name" value="Новый вариант"></label>
<label>Поле <input id="group" value="watched"></label>
<select id="preset"><option value="a">Alpha</option><option value="b">Beta</option></select>
<button id="rename">Переименовать</button><button id="update">Редактировать</button>
<button id="delete">Удалить</button><button id="reload">Перечитать</button>
<ul id="items"></ul><p id="status" role="status"></p>
</body></html>'''
SETUP='''async () => {
const clone=x=>JSON.parse(JSON.stringify(x));
let generated=0;
window.ackLoss=false;
const api=window.createXodVersionedPresetSessions({
 read:()=>window.casRead(),
 transaction: async (mutator)=> {
   for(let tries=0;tries<20;tries++) {
     const snap=await window.casRead();
     const draft=clone(snap.data);
     const result=mutator(draft);
     const answer=await window.casWrite(snap.revision,draft);
     if(!answer.ok) continue;
     if(window.ackLoss) {window.ackLoss=false;throw Error('lost ACK');}
     return result;
   }
   const e=Error('CAS retry exceeded'); e.code='XOD_CAS_RETRY_LIMIT'; throw e;
 },
 makeId:()=>`new-preset-${++generated}`
});
window.editor=await api.openSession();
window.render=function(items){
  let ul=document.querySelector('#items');ul.replaceChildren();
  items.forEach(item=>{
    let li=document.createElement('li');li.dataset.id=item.id;
    li.textContent=`${item.name} · ${item.view?.group?.key||'none'}`;
    ul.appendChild(li);
  });
};
window.run=async command=>{
 try {
  const list=await window.editor.onChangePreset(command);
  window.render(list);
  document.querySelector('#status').textContent='Сохранено';
  return {ok:true,list};
 }catch(error){
  document.querySelector('#status').textContent=error.code||error.message;
  return {ok:false,code:error.code||error.message};
 }
};
window.render(window.editor.presets);
function cmd(op){const id=document.querySelector('#preset').value;
if(op==='rename')return {op,id,name:document.querySelector('#name').value};
if(op==='update')return {op,id,view:{filter:null,sort:[],group:{key:document.querySelector('#group').value,dir:'asc'}}};
return {op,id};}
['rename','update','delete'].forEach(op=>{
  document.querySelector('#'+op).addEventListener('click',async()=>{window.last=await window.run(cmd(op));});
});
document.querySelector('#reload').addEventListener('click',async()=>{
 const list=await window.editor.reload();window.render(list);
 document.querySelector('#status').textContent='Перечитано';
});
return true;
}'''

class Server:
    def __init__(self): self.reset()
    def reset(self):
        self.data={'views':{},'presets':[
          {'id':'a','name':'Alpha','view':{'filter':None,'sort':[],'group':{'key':'category','dir':'asc'}}},
          {'id':'b','name':'Beta','view':{'filter':None,'sort':[],'group':{'key':'watched','dir':'asc'}}}],
          'presetRevisions':{'a':0,'b':0},'presetReceipts':{}}
        self.rev=0;self.lock=asyncio.Lock();self.conflicts=0
    async def read(self):
        await asyncio.sleep(0.001)
        return {'revision':self.rev,'data':copy.deepcopy(self.data)}
    async def write(self,version,nextdata):
        async with self.lock:
            await asyncio.sleep(0.001)
            if version != self.rev: self.conflicts+=1;return {'ok':False}
            self.data=copy.deepcopy(nextdata);self.rev+=1;return {'ok':True}

async def page_for(context,server):
    page=await context.new_page()
    errors=[]
    page.on('pageerror',lambda e:errors.append(str(e)))
    await page.expose_function('casRead',server.read)
    await page.expose_function('casWrite',server.write)
    await page.set_content(HTML)
    await page.add_script_tag(content=JS)
    assert await page.evaluate(SETUP)
    return page,errors

async def press(page,op,id='a',name='N',key='genre'):
    await page.locator('#preset').select_option(id)
    await page.locator('#name').fill(name)
    await page.locator('#group').fill(key)
    await page.locator('#'+op).click()
    await page.wait_for_function('window.last !== undefined')
    result=await page.evaluate('window.last')
    await page.evaluate('delete window.last')
    return result

async def main():
    passed=0;errors=[]
    async with async_playwright() as p:
        browser=await p.chromium.launch(headless=True,executable_path='/usr/bin/chromium',args=['--no-sandbox'])
        context=await browser.new_context()
        async def scenario(name,fn):
            nonlocal passed
            server=Server()
            a,err_a=await page_for(context,server); b,err_b=await page_for(context,server)
            try:
                await fn(a,b,server)
                assert not err_a and not err_b, f'JS errors {err_a+err_b}'
                passed+=1;print('PASS',name)
            except Exception as ex:
                print('FAIL',name,repr(ex));errors.append(name)
            finally:
                await a.close();await b.close()
        async def rename_conflict(a,b,s):
            assert (await press(a,'rename',name='A changed'))['ok']
            old=await press(b,'rename',name='B stale')
            assert old['code']=='XOD_PRESET_CONFLICT',old
            assert s.data['presets'][0]['name']=='A changed'
            assert 'Alpha' in await b.locator('li[data-id="a"]').inner_text()  # local unsaved form persists
        await scenario('01 stale rename rejected; second browser keeps its local UI',rename_conflict)
        async def update_conflict(a,b,s):
            assert (await press(a,'update',key='new-data'))['ok']
            assert (await press(b,'rename',name='stale'))['code']=='XOD_PRESET_CONFLICT'
            assert s.data['presets'][0]['view']['group']['key']=='new-data'
        await scenario('02 stale rename after update rejected',update_conflict)
        async def delete_conflict(a,b,s):
            assert (await press(a,'rename',name='New Name'))['ok']
            assert (await press(b,'delete'))['code']=='XOD_PRESET_CONFLICT'
            assert len(s.data['presets'])==2
        await scenario('03 stale delete rejected',delete_conflict)
        async def nonconflict(a,b,s):
            out=await asyncio.gather(press(a,'rename',id='a',name='NameA'),press(b,'update',id='b',key='freshB'))
            assert out[0]['ok'] and out[1]['ok'],out
            assert s.data['presets'][0]['name']=='NameA'
            assert s.data['presets'][1]['view']['group']['key']=='freshB'
        await scenario('04 two tabs edit distinct IDs without lost update',nonconflict)
        async def reload_flow(a,b,s):
            assert (await press(a,'rename',name='Remote'))['ok']
            assert (await press(b,'rename',name='Local'))['code']=='XOD_PRESET_CONFLICT'
            await b.locator('#reload').click()
            await b.wait_for_function('document.querySelector("#status").textContent === "Перечитано"')
            assert (await press(b,'rename',name='Resolved'))['ok']
            assert s.data['presets'][0]['name']=='Resolved'
        await scenario('05 explicit reload resolves conflict then save',reload_flow)
        async def late_ack(a,b,s):
            await a.evaluate('window.ackLoss=true')
            result=await press(a,'update',key='committed')
            assert result['code']=='lost ACK',result
            assert s.data['presets'][0]['view']['group']['key']=='committed'
            blocked=await press(a,'rename',name='Unsafe')
            assert blocked['code']=='XOD_PRESET_RECONCILIATION_REQUIRED',blocked
            await a.locator('#reload').click()
            await a.wait_for_function('document.querySelector("#status").textContent === "Перечитано"')
            assert (await press(a,'rename',name='Safe'))['ok']
        await scenario('06 uncertain update blocks blind retry in real DOM',late_ack)
        async def delete_tombstone(a,b,s):
            assert (await press(a,'delete'))['ok']
            assert (await press(b,'update',key='old'))['code']=='XOD_PRESET_CONFLICT'
            assert not any(p['id']=='a' for p in s.data['presets'])
            assert s.data['presetRevisions']['a']==1
        await scenario('07 deleted ID tombstone prevents stale update',delete_tombstone)
        await context.close();await browser.close()
    print(f'RESULT {passed}/7 {"PASS" if passed==7 else "FAIL"}')
    if errors: raise SystemExit(1)

if __name__=='__main__':asyncio.run(main())
