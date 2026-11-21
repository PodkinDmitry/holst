/* XOD CHAT 05: deterministic randomized audit. Run:
 * node randomized-group-audit.js ../chat-04/xod-youtube-table300.js
 */
'use strict';
const fs=require('fs'), vm=require('vm'), assert=require('assert/strict');
const src=process.argv[2] || __dirname+'/../chat-04/xod-youtube-table300.js';
const window={};
vm.runInNewContext(fs.readFileSync(src,'utf8'),{window});
const {computeView,computeGroups}=window.mountYoutubeTable300;
let state=0xC0FFEE;
const rnd=n=>{state^=state<<13;state^=state>>>17;state^=state<<5;return (state>>>0)%n;};
const choice=x=>x[rnd(x.length)];
const types=['video','channel','playlist'];
const fields=[
 {key:'category',types:types.slice(),options:[{value:'inbox',label:'Входящие'},{value:'fav',label:'Избранное'}]},
 {key:'watched',types:['video'],options:[{value:'no',label:'Нет'},{value:'yes',label:'Да'}]},
 {key:'subscribed',types:['channel'],options:[{value:'no',label:'Нет'},{value:'yes',label:'Да'}]},
 {key:'sortmode',types:['playlist'],options:[{value:'new',label:'Новые'},{value:'old',label:'Старые'}]}
];
const opts={category:['inbox','fav','unknown',''],watched:['no','yes','unknown',''],subscribed:['no','yes',''],sortmode:['new','old','']};
const groupKey=(entry,field)=>{
 if(!field.types.includes(entry.type))return 'na:';
 const value=entry.values[field.key];
 return value?'value:'+value:'empty:';
};
const tier=g=>g.kind==='value'?0:g.kind==='empty'?1:2;
let count=0,total=0;
for(let k=0;k<12000;k++){
 const entries=Array.from({length:rnd(34)},(_,i)=>{
  const type=choice(types),values={};
  for(const f of fields)if(rnd(4)!==0)values[f.key]=choice(opts[f.key]);
  return {id:'case'+k+':row'+i,type,title:'Строка '+i+' <b>&',values};
 });
 const view={filter:null,sort:[],group:{key:choice(fields).key,dir:choice(['asc','desc'])}};
 const field=fields.find(x=>x.key===view.group.key);
 if(rnd(2))view.sort.push({key:choice(fields).key,dir:choice(['asc','desc'])});
 if(rnd(2))view.sort.push({key:choice(fields).key,dir:choice(['asc','desc'])});
 if(rnd(3)===0){
  const f=choice(fields),op=choice(['eq','set','unset']);
  const leaf={key:f.key,op};
  if(op==='eq')leaf.value=choice(opts[f.key]);
  view.filter={op:choice(['and','or']),children:[leaf]};
 }
 const before=JSON.stringify({entries,view});
 const filtered=computeView(entries,fields,view),groups=computeGroups(entries,fields,view);
 assert.equal(JSON.stringify({entries,view}),before,'Inputs mutated');
 assert.ok(groups.every(g=>g.entries.length>0)||(groups.length===1&&groups[0].kind==='all'),'Empty group');
 const ids=groups.flatMap(g=>g.entries.map(e=>e.id));
 assert.equal(ids.length,filtered.length,'Missing/duplicate rows');
 assert.equal(JSON.stringify(ids.slice().sort()),JSON.stringify(filtered.map(e=>e.id).sort()),'Partition mismatch');
 for(const group of groups){
  const expected=filtered.filter(e=>groupKey(e,field)===group.kind+':'+(group.value||''));
  assert.equal(JSON.stringify(group.entries.map(e=>e.id)),JSON.stringify(expected.map(e=>e.id)),'Within-group sort changed');
 }
 for(let i=1;i<groups.length;i++){
  const a=groups[i-1],b=groups[i];assert.ok(tier(a)<=tier(b),'Tier order invalid');
  if(a.kind==='value'&&b.kind==='value'){
   const arr=field.options.map(x=>x.value),rank=v=>{const i=arr.indexOf(v);return i<0?arr.length:i;};
   const cmp=rank(a.value)-rank(b.value)||(a.value<b.value?-1:a.value>b.value?1:0);
   assert.ok(view.group.dir==='asc'?cmp<=0:cmp>=0,'Group order invalid');
  }
 }
 count++;total+=entries.length;
}
console.log('PASS deterministic randomized-group-audit: '+count+' scenarios, '+total+' generated rows');
