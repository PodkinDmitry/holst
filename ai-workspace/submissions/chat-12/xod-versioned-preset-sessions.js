/* XOD CHAT 12: version-aware preset sessions for independent browser tabs.
 * Requires a host read() and a REAL atomic transaction(mutator) (CHAT 11 CAS or equivalent).
 * Returns the unchanged onChangePreset(command) -> full presets[] UI contract.
 */
(function (root, factory) {
  'use strict';
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.createXodVersionedPresetSessions = api;
}(typeof globalThis === 'object' ? globalThis : this, function () {
  'use strict';
  var own = Object.prototype.hasOwnProperty;
  function plain(x) { return x !== null && typeof x === 'object' && !Array.isArray(x); }
  function clone(x) { return JSON.parse(JSON.stringify(x)); }
  function fail(code, message) { var error = new Error(message); error.code = code; return error; }
  function put(o, k, v) { Object.defineProperty(o, k, {value:v, enumerable:true, writable:true, configurable:true}); }
  function revisionFor(doc, id) {
    if (doc.presetRevisions === undefined) return 0;
    if (!plain(doc.presetRevisions)) throw fail('XOD_BAD_STORE','Некорректный presetRevisions.');
    var r = own.call(doc.presetRevisions, id) ? doc.presetRevisions[id] : 0;
    if (!Number.isSafeInteger(r) || r < 0) throw fail('XOD_BAD_STORE','Некорректная ревизия пресета.');
    return r;
  }
  function snapshotFrom(raw) {
    var data = raw && plain(raw.data) ? raw.data : raw;
    if (!plain(data) || !Array.isArray(data.presets)) throw fail('XOD_BAD_STORE', 'read() должен вернуть документ с presets[].');
    var ids = new Set();
    data.presets.forEach(function(p) {
      if (!plain(p) || typeof p.id !== 'string' || !p.id || ids.has(p.id) ||
          typeof p.name !== 'string' || !plain(p.view)) throw fail('XOD_BAD_STORE','Некорректный пресет.');
      ids.add(p.id);
      revisionFor(data,p.id);
    });
    return data;
  }
  function createXodVersionedPresetSessions(config) {
    if (!plain(config) || typeof config.read !== 'function' ||
        typeof config.transaction !== 'function' || typeof config.makeId !== 'function') {
      throw new TypeError('Нужны read(), атомарная transaction(mutator) и makeId().');
    }
    async function openSession() {
      var initial = snapshotFrom(await config.read());
      var baseline = new Map(initial.presets.map(function(p){return [p.id,revisionFor(initial,p.id)];}));
      var closed = false, uncertain = false, uncertainCreateId = null, tail = Promise.resolve();
      function enqueue(operation) {
        var job = tail.then(function(){
          if (closed) throw fail('XOD_PRESET_SESSION_CLOSED','Редактор пресетов закрыт.');
          return operation();
        });
        tail = job.then(function(){},function(){});
        return job;
      }
      function onChangePreset(command) {
        var input;
        try {
          input = clone(command);
          if (!plain(input) || !['create','rename','update','delete'].includes(input.op)) {
            throw fail('XOD_BAD_PRESET_COMMAND','Неизвестная команда.');
          }
          if (input.op === 'create') {
            if (typeof input.operationId !== 'string' || !input.operationId ||
                typeof input.name !== 'string' || !input.name.trim() || !plain(input.view)) {
              throw fail('XOD_BAD_PRESET_COMMAND','Для create нужны operationId, name и view.');
            }
          } else {
            if (typeof input.id !== 'string' || !input.id) throw fail('XOD_BAD_PRESET_COMMAND','Нужен ID пресета.');
            if (input.op === 'rename' && (typeof input.name !== 'string' || !input.name.trim()))
              throw fail('XOD_BAD_PRESET_COMMAND','Нужно имя пресета.');
            if (input.op === 'update' && !plain(input.view))
              throw fail('XOD_BAD_PRESET_COMMAND','Нужен вид пресета.');
          }
        } catch(error) { return Promise.reject(error); }
        return enqueue(async function(){
          if (uncertain && !(input.op === 'create' && input.operationId === uncertainCreateId))
            throw fail('XOD_PRESET_RECONCILIATION_REQUIRED',
            'Предыдущая запись пресетов имеет неизвестный результат. Сначала перечитайте хранилище.');
          var newId;
          if (input.op === 'create') {
            newId = config.makeId();
            if (typeof newId !== 'string' || !newId) throw fail('XOD_BAD_PRESET_ID','makeId вернул неверный ID.');
          }
          var signature = input.op === 'create' ? JSON.stringify({name:input.name,view:input.view}) : null;
          var expected = input.op === 'create' ? null : baseline.get(input.id);
          if (input.op !== 'create' && expected === undefined)
            throw fail('XOD_PRESET_NOT_IN_SESSION','Этот пресет не был загружен редактором. Обновите список.');
          var result;
          try {
            result = await config.transaction(function(draft){
              if (!Array.isArray(draft.presets)) throw fail('XOD_BAD_STORE','Некорректный массив пресетов.');
              if (!plain(draft.presetRevisions)) draft.presetRevisions = {};
              if (!plain(draft.presetReceipts)) draft.presetReceipts = {};
              var list = draft.presets;
              var changedId = null, changedRevision = null;
              if (input.op === 'create') {
                if (own.call(draft.presetReceipts,input.operationId)) {
                  var receipt = draft.presetReceipts[input.operationId];
                  if (!receipt || receipt.signature !== signature)
                    throw fail('XOD_OPERATION_ID_COLLISION','Повтор operationId с иным содержимым.');
                  changedId = receipt.id;
                  changedRevision = revisionFor(draft,changedId);
                } else {
                  if (list.some(function(p){return p && p.id===newId;}) || own.call(draft.presetRevisions,newId))
                    throw fail('XOD_PRESET_ID_COLLISION','ID пресета уже использован.');
                  list.push({id:newId,name:input.name,view:clone(input.view)});
                  put(draft.presetReceipts,input.operationId,{id:newId,signature:signature});
                  put(draft.presetRevisions,newId,0);
                  changedId = newId;
                  changedRevision = 0;
                }
              } else {
                var index = list.findIndex(function(p){return p && p.id===input.id;});
                var actual = revisionFor(draft,input.id);
                if (index < 0 || actual !== expected) {
                  var conflict = fail('XOD_PRESET_CONFLICT','Пресет изменён или удалён в другом редакторе.');
                  conflict.id = input.id;
                  conflict.expectedRevision = expected;
                  conflict.actualRevision = actual;
                  conflict.remotePreset = index < 0 ? null : clone(list[index]);
                  throw conflict;
                }
                if (actual === Number.MAX_SAFE_INTEGER)
                  throw fail('XOD_REVISION_EXHAUSTED','Счётчик ревизий пресета исчерпан.');
                if (input.op === 'delete') list.splice(index,1);
                else if (input.op === 'rename') list[index].name = input.name;
                else list[index].view = clone(input.view);
                put(draft.presetRevisions,input.id,actual+1); // Tombstone on deletion.
                changedId = input.id;
                changedRevision = actual+1;
              }
              return {presets:clone(list),id:changedId,revision:changedRevision,deleted:input.op==='delete'};
            });
          } catch(error) {
            // Known read/CAS conflicts are definitive; unknown transport outcomes are not.
            if (!error || !['XOD_PRESET_CONFLICT','XOD_PRESET_ID_COLLISION',
              'XOD_OPERATION_ID_COLLISION','XOD_BAD_STORE','XOD_CAS_RETRY_LIMIT',
              'XOD_REVISION_EXHAUSTED'].includes(error.code)) {
              uncertain = true;
              uncertainCreateId = input.op === 'create' ? input.operationId : null;
            }
            throw error;
          }
          if (result.deleted || !result.presets.some(function(p){return p.id === result.id;})) baseline.delete(result.id);
          else baseline.set(result.id,result.revision);
          uncertain = false;
          uncertainCreateId = null;
          return result.presets;
        });
      }
      function reload() {
        return enqueue(async function(){
          var doc=snapshotFrom(await config.read());
          baseline=new Map(doc.presets.map(function(p){return [p.id,revisionFor(doc,p.id)];}));
          uncertain=false;
          uncertainCreateId=null;
          return clone(doc.presets);
        });
      }
      return {presets:clone(initial.presets),onChangePreset:onChangePreset,reload:reload,
        dispose:function(){closed=true;}};
    }
    return {openSession:openSession};
  }
  return createXodVersionedPresetSessions;
}));
