/* XOD CHAT 08: reference coordinator for multiple YouTube table surfaces.
   No persistence is implemented here. The SOL host supplies read/write functions.
   Independent runtime instances and cross-tab writes require host-side CAS/versioning. */
(function (root, make) {
  'use strict';
  var api = make();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.createXodViewStoreCoordinator = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  function clone(value) { return JSON.parse(JSON.stringify(value)); }
  function plainObject(value) {
    return value && typeof value === 'object' && !Array.isArray(value);
  }
  function createXodViewStoreCoordinator(adapter) {
    if (!adapter || typeof adapter.read !== 'function' || typeof adapter.write !== 'function') {
      throw new TypeError('Требуются адаптеры read() и write(snapshot).');
    }
    var tail = Promise.resolve();
    function transaction(mutator) {
      if (typeof mutator !== 'function') return Promise.reject(new TypeError('Ожидается функция изменения хранилища.'));
      var job = tail.then(async function () {
        var original = await adapter.read();
        if (!plainObject(original)) throw new TypeError('read() должен вернуть объект состояния.');
        // Never expose the adapter's original object to the mutator.
        var draft = clone(original);
        var value = await mutator(draft);
        // Adapter must resolve write() only when the write is actually committed.
        await adapter.write(draft);
        return value;
      });
      // A rejected operation must not poison subsequent writes.
      tail = job.then(function () {}, function () {});
      return job;
    }
    function saveView(scope, view) {
      if (typeof scope !== 'string' || scope.length === 0) return Promise.reject(new TypeError('Нужен непустой ключ вида.'));
      var snapshot;
      try {
        snapshot = clone(view);
        if (!plainObject(snapshot)) throw new TypeError('Вид должен быть объектом.');
      } catch (error) { return Promise.reject(error); }
      return transaction(function (state) {
        if (!plainObject(state.views)) state.views = {};
        // Prevent prototype assignment for keys such as "__proto__".
        Object.defineProperty(state.views, scope, {
          value: snapshot, configurable: true, enumerable: true, writable: true
        });
      });
    }
    function bindView(scope) {
      if (typeof scope !== 'string' || !scope) throw new TypeError('Нужен непустой ключ вида.');
      return function (view) { return saveView(scope, view); };
    }
    return { transaction: transaction, saveView: saveView, bindView: bindView };
  }
  return createXodViewStoreCoordinator;
}));
