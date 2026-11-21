/* XOD CHAT 09 — cross-runtime optimistic view coordinator.
 * This module does NOT provide storage. adapter.compareAndSwap must be ATOMIC
 * in the host's persistence layer (e.g. IndexedDB transaction/server ETag).
 * No localStorage read+write sequence can satisfy this precondition.
 */
(function (root, factory) {
  'use strict';
  var exported = factory();
  if (typeof module === 'object' && module.exports) module.exports = exported;
  else root.createXodCasViewCoordinator = exported;
}(typeof globalThis === 'object' ? globalThis : this, function () {
  'use strict';
  var hasOwn = Object.prototype.hasOwnProperty;
  function plain(value) {
    return !!value && typeof value === 'object' && !Array.isArray(value);
  }
  function copy(value) {
    return JSON.parse(JSON.stringify(value));
  }
  function fail(code, message) {
    var error = new Error(message);
    error.code = code;
    return error;
  }
  // Canonical JSON equality: key order may change after a storage round-trip.
  function sameJson(a, b) {
    if (a === b) return true;
    if (Array.isArray(a) || Array.isArray(b)) {
      return Array.isArray(a) && Array.isArray(b) && a.length === b.length &&
        a.every(function (item, i) { return sameJson(item, b[i]); });
    }
    if (plain(a) && plain(b)) {
      var ak = Object.keys(a).sort();
      var bk = Object.keys(b).sort();
      return ak.length === bk.length && ak.every(function (key, i) {
        return key === bk[i] && sameJson(a[key], b[key]);
      });
    }
    return false;
  }
  function setOwn(object, key, value) {
    // Protect special keys (__proto__/constructor) without changing public scope names.
    Object.defineProperty(object, key, {value: value, configurable: true, writable: true, enumerable: true});
  }
  function revisionFor(document, scope) {
    var map = document.viewRevisions;
    if (map === undefined) return 0;
    if (!plain(map)) throw fail('XOD_BAD_STORE', 'viewRevisions должен быть объектом.');
    var value = hasOwn.call(map, scope) ? map[scope] : 0;
    if (!Number.isSafeInteger(value) || value < 0) {
      throw fail('XOD_BAD_STORE', 'Некорректная ревизия вида.');
    }
    return value;
  }
  function viewFor(document, scope) {
    if (document.views === undefined) return null;
    if (!plain(document.views)) throw fail('XOD_BAD_STORE', 'views должен быть объектом.');
    var value = hasOwn.call(document.views, scope) ? document.views[scope] : null;
    return value === null ? null : copy(value);
  }
  function validateRead(state) {
    if (!plain(state) || !hasOwn.call(state, 'revision') ||
        !(typeof state.revision === 'string' || Number.isSafeInteger(state.revision)) ||
        !plain(state.data)) {
      throw fail('XOD_BAD_STORE', 'read() должен вернуть {revision, data: объект}.');
    }
    return state;
  }
  function createXodCasViewCoordinator(adapter) {
    if (!plain(adapter) || typeof adapter.read !== 'function' ||
        typeof adapter.compareAndSwap !== 'function') {
      throw new TypeError('Нужны read() и атомарный compareAndSwap(expectedRevision, data).');
    }
    var attempts = adapter.maxAttempts === undefined ? 8 : adapter.maxAttempts;
    if (!Number.isSafeInteger(attempts) || attempts < 1 || attempts > 100) {
      throw new TypeError('maxAttempts должен быть целым числом от 1 до 100.');
    }
    // Safe only if every writer touching this document honors its atomic CAS.
    async function transaction(mutator, onUnknownCommit) {
      if (typeof mutator !== 'function') throw new TypeError('Нужна чистая синхронная функция изменения.');
      for (var i = 0; i < attempts; i += 1) {
        var current = validateRead(await adapter.read());
        var draft = copy(current.data);
        var result = mutator(draft);
        if (result && typeof result.then === 'function') {
          throw new TypeError('Мутатор должен быть синхронным: он повторяется после CAS-конфликта.');
        }
        // Do not retry exceptions here: a write could have actually committed.
        var outcome;
        try {
          outcome = await adapter.compareAndSwap(current.revision, draft);
        } catch (error) {
          // A transport failure can happen after the atomic commit has succeeded.
          if (typeof onUnknownCommit === 'function') onUnknownCommit();
          throw error;
        }
        if (!plain(outcome) || typeof outcome.ok !== 'boolean') {
          if (typeof onUnknownCommit === 'function') onUnknownCommit();
          throw fail('XOD_UNKNOWN_COMMIT', 'CAS вернул неопределённый результат. Перечитайте хранилище.');
        }
        if (outcome.ok) return result;
      }
      throw fail('XOD_CAS_RETRY_LIMIT', 'Слишком много конфликтующих записей, попробуйте позднее.');
    }
    async function openView(scope) {
      if (typeof scope !== 'string' || !scope) throw new TypeError('Нужен непустой ключ вида.');
      var current = validateRead(await adapter.read());
      var baseline = revisionFor(current.data, scope);
      var closed = false;
      var uncertain = null; // An interrupted CAS may have committed despite a lost reply.
      var tail = Promise.resolve();
      function enqueue(fn) {
        var job = tail.then(function () {
          if (closed) throw fail('XOD_VIEW_CLOSED', 'Редактор вида уже закрыт.');
          return fn();
        });
        tail = job.then(function () {}, function () {});
        return job;
      }
      function onSaveView(view) {
        var snapshot;
        try {
          snapshot = copy(view);
          if (!plain(snapshot)) throw new TypeError('Вид должен быть объектом.');
        } catch (error) { return Promise.reject(error); }
        return enqueue(function () {
          if (uncertain) {
            throw fail('XOD_RECONCILIATION_REQUIRED',
              'Предыдущее сохранение имеет неизвестный результат. Сначала проверьте его состояние.');
          }
          return transaction(function (draft) {
            var remoteRevision = revisionFor(draft, scope);
            if (remoteRevision !== baseline) {
              var conflict = fail('XOD_VIEW_CONFLICT',
                'Вид изменён в другой вкладке. Обновите настройки или явно разрешите конфликт.');
              conflict.scope = scope;
              conflict.expectedRevision = baseline;
              conflict.actualRevision = remoteRevision;
              throw conflict;
            }
            if (remoteRevision === Number.MAX_SAFE_INTEGER) {
              throw fail('XOD_REVISION_EXHAUSTED', 'Счётчик ревизий вида исчерпан.');
            }
            if (!plain(draft.views)) draft.views = {};
            if (!plain(draft.viewRevisions)) draft.viewRevisions = {};
            setOwn(draft.views, scope, copy(snapshot));
            setOwn(draft.viewRevisions, scope, remoteRevision + 1);
          }, function () {
            uncertain = {baseline: baseline, view: copy(snapshot)};
          }).then(function () {
            baseline += 1;
          });
        });
      }
      // Reconcile after a lost/invalid CAS acknowledgement, without submitting a new write.
      // A still-unchanged revision is *unconfirmed*, not proof that the old write failed:
      // a remote server may still finish an in-flight request.
      function reconcile() {
        return enqueue(async function () {
          if (!uncertain) return {status: 'clear', revision: baseline};
          var latest = validateRead(await adapter.read());
          var remoteRevision = revisionFor(latest.data, scope);
          var remoteView = viewFor(latest.data, scope);
          if (remoteRevision > uncertain.baseline && sameJson(remoteView, uncertain.view)) {
            baseline = remoteRevision;
            uncertain = null;
            return {status: 'observed', revision: baseline, view: remoteView};
          }
          if (remoteRevision > uncertain.baseline) {
            return {status: 'conflict', revision: remoteRevision,
              remoteView: remoteView, pendingView: copy(uncertain.view)};
          }
          return {status: 'unconfirmed', revision: remoteRevision,
            pendingView: copy(uncertain.view)};
        });
      }
      function reload() {
        return enqueue(async function () {
          var latest = validateRead(await adapter.read());
          var view = viewFor(latest.data, scope);
          baseline = revisionFor(latest.data, scope);
          // Explicit reload is a caller decision to abandon the unresolved local intent.
          uncertain = null;
          return {view: view, revision: baseline};
        });
      }
      return {
        view: viewFor(current.data, scope),
        revision: baseline,
        onSaveView: onSaveView,
        reconcile: reconcile,
        reload: reload,
        dispose: function () { closed = true; }
      };
    }
    return {transaction: transaction, openView: openView};
  }
  return createXodCasViewCoordinator;
}));
