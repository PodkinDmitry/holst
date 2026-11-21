/* XOD CHAT 10 — reference idempotent onChangePreset adapter.
 * Requires an ATOMIC transaction coordinator such as CHAT 09 CAS.
 * Receipts are persisted in draft.presetReceipts alongside draft.presets.
 */
(function (root, factory) {
  'use strict';
  var api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  else root.createXodPresetIdempotencyAdapter=api;
}(typeof globalThis==='object'?globalThis:this,function(){
  'use strict';
  var hasOwn=Object.prototype.hasOwnProperty;
  function plain(x){return !!x&&typeof x==='object'&&!Array.isArray(x);}
  function clone(x){return JSON.parse(JSON.stringify(x));}
  function err(code,message){var e=new Error(message);e.code=code;return e;}
  function setOwn(o,k,v){Object.defineProperty(o,k,{value:v,enumerable:true,configurable:true,writable:true});}
  function createXodPresetIdempotencyAdapter(config){
    if(!config||typeof config.transaction!=='function'||typeof config.makeId!=='function'){
      throw new TypeError('Нужны атомарная transaction(mutator) и makeId().');
    }
    return function onChangePreset(command){
      var input;
      try {
        input=clone(command);
        if(!plain(input)||!['create','update','rename','delete'].includes(input.op)){
          throw err('XOD_BAD_PRESET_COMMAND','Неизвестная команда пресета.');
        }
        if(input.op==='create'){
          if(typeof input.operationId!=='string'||!input.operationId){
            throw err('XOD_OPERATION_ID_REQUIRED','Для безопасного создания необходим operationId.');
          }
          if(typeof input.name!=='string'||!input.name.trim()||!plain(input.view)){
            throw err('XOD_BAD_PRESET_COMMAND','Нужны имя и вид пресета.');
          }
        } else {
          if(typeof input.id!=='string'||!input.id)throw err('XOD_BAD_PRESET_COMMAND','Нужен ID пресета.');
          if(input.op==='update'&&!plain(input.view))throw err('XOD_BAD_PRESET_COMMAND','Нужен вид.');
          if(input.op==='rename'&&(typeof input.name!=='string'||!input.name.trim())){
            throw err('XOD_BAD_PRESET_COMMAND','Нужно непустое имя.');
          }
        }
      }catch(e){return Promise.reject(e);}
      // Generated ONCE, outside the CAS mutator: retry must be side-effect-free.
      var newId;
      try{if(input.op==='create'){
        newId=config.makeId();
        if(typeof newId!=='string'||!newId)throw err('XOD_BAD_PRESET_ID','makeId должен вернуть непустую строку.');
      }}catch(e){return Promise.reject(e);}
      var signature=input.op==='create'?JSON.stringify({name:input.name,view:input.view}):'';
      return config.transaction(function(draft){
        if(!Array.isArray(draft.presets))draft.presets=[];
        if(!plain(draft.presetReceipts))draft.presetReceipts={};
        if(input.op==='create'){
          if(hasOwn.call(draft.presetReceipts,input.operationId)){
            var receipt=draft.presetReceipts[input.operationId];
            if(!receipt||receipt.signature!==signature){
              throw err('XOD_OPERATION_ID_COLLISION','Одинаковый operationId для разных команд.');
            }
            return clone(draft.presets);
          }
          if(draft.presets.some(function(x){return x&&x.id===newId;})){
            throw err('XOD_PRESET_ID_COLLISION','Сгенерирован существующий ID пресета.');
          }
          draft.presets.push({id:newId,name:input.name,view:clone(input.view)});
          setOwn(draft.presetReceipts,input.operationId,{id:newId,signature:signature});
          return clone(draft.presets);
        }
        var found=draft.presets.find(function(x){return x&&x.id===input.id;});
        if(input.op==='delete'){
          draft.presets=draft.presets.filter(function(x){return x&&x.id!==input.id;});
        }else{
          if(!found)throw err('XOD_PRESET_NOT_FOUND','Пресет не найден.');
          if(input.op==='rename')found.name=input.name;
          else if(input.op==='update')found.view=clone(input.view);
        }
        return clone(draft.presets);
      });
    };
  }
  return createXodPresetIdempotencyAdapter;
}));
