/* XOD YouTube Table 300 — dependency-free browser component.
 * Public API: window.mountYoutubeTable300(root, { entries, fields, onApply })
 * No persistence or network access is performed by this component.
 */
(function () {
  'use strict';

  function mountYoutubeTable300(root, config) {
    if (!root || root.nodeType !== 1) {
      throw new TypeError('root должен быть DOM-элементом');
    }
    if (!config || !Array.isArray(config.entries) || !Array.isArray(config.fields) ||
        typeof config.onApply !== 'function') {
      throw new TypeError('Ожидаются entries, fields и функция onApply');
    }

    var doc = root.ownerDocument;
    var typeNames = { video: 'Видео', channel: 'Канал', playlist: 'Плейлист' };
    var typeGroups = { video: 'Видео', channel: 'Каналы', playlist: 'Плейлисты' };
    var kindOrder = ['Общие', 'Видео', 'Каналы', 'Плейлисты'];
    var addedClass = !root.classList.contains('yt-table300');
    root.classList.add('yt-table300');

    var fields = config.fields.map(function (field) {
      return {
        key: field.key,
        label: field.label,
        types: Array.isArray(field.types) ? field.types.slice() : [],
        options: Array.isArray(field.options) ? field.options.map(function (option) {
          return { value: option.value, label: option.label };
        }) : []
      };
    });
    var fieldByKey = new Map(fields.map(function (field) { return [field.key, field]; }));
    var entries = copyEntries(config.entries);
    var selectedIds = new Set();
    var pending = false;
    var destroyed = false;
    var currentFieldIndex = -1;
    var currentOptionIndex = -1;

    function copyEntries(source) {
      return source.map(function (entry) {
        return {
          id: entry.id,
          type: entry.type,
          title: entry.title,
          values: Object.assign({}, entry.values || {})
        };
      });
    }

    function element(tag, className, text) {
      var node = doc.createElement(tag);
      if (className) node.className = className;
      if (text !== undefined) node.textContent = String(text);
      return node;
    }

    function availableFor(field, type) {
      return field.types.indexOf(type) !== -1;
    }

    function selectedEntries() {
      return entries.filter(function (entry) { return selectedIds.has(entry.id); });
    }

    function selectedField() {
      return currentFieldIndex >= 0 ? fields[currentFieldIndex] : null;
    }

    function selectedOption() {
      var field = selectedField();
      return field && currentOptionIndex >= 0 ? field.options[currentOptionIndex] : null;
    }

    function setAccessibleText(node, value) {
      node.textContent = String(value);
    }

    function fieldGroup(field) {
      var types = new Set(field.types);
      if (types.size !== 1) return 'Общие';
      return typeGroups[field.types[0]] || 'Общие';
    }

    function fieldQualifier(field) {
      if (field.types.length === 3) return '';
      return ' (' + field.types.map(function (type) {
        return typeNames[type] || type;
      }).join(', ') + ')';
    }

    var heading = element('h2', 'yt-table300__heading', 'Таблица YouTube');
    var selectionNote = element('p', 'yt-table300__selection', 'Выбрано: 0');
    selectionNote.setAttribute('aria-live', 'polite');

    var scroll = element('div', 'yt-table300__scroll');
    scroll.setAttribute('tabindex', '0');
    scroll.setAttribute('aria-label', 'Таблица YouTube, прокручивается по горизонтали');
    var table = element('table', 'yt-table300__table');
    var caption = element('caption', 'yt-table300__caption', 'Записи YouTube и их свойства');
    var thead = element('thead');
    var headRow = element('tr');
    var selectHead = element('th');
    selectHead.scope = 'col';
    var allLabel = element('label', 'yt-table300__check-label');
    var allCheckbox = element('input', 'yt-table300__select-all');
    allCheckbox.type = 'checkbox';
    allCheckbox.setAttribute('aria-label', 'Выделить все записи');
    allLabel.appendChild(allCheckbox);
    allLabel.appendChild(element('span', 'yt-table300__sr-only', 'Выделить все записи'));
    selectHead.appendChild(allLabel);
    headRow.appendChild(selectHead);
    [['Название', true], ['Тип', false]].forEach(function (head) {
      var th = element('th', '', head[0]);
      th.scope = 'col';
      headRow.appendChild(th);
    });
    fields.forEach(function (field) {
      var th = element('th', '', field.label);
      th.scope = 'col';
      headRow.appendChild(th);
    });
    thead.appendChild(headRow);
    var tbody = element('tbody', 'yt-table300__body');
    table.appendChild(caption);
    table.appendChild(thead);
    table.appendChild(tbody);
    scroll.appendChild(table);

    var form = element('form', 'yt-table300__editor');
    form.noValidate = true;
    var formHeading = element('h3', 'yt-table300__editor-heading', 'Изменить выделенные записи');
    var formControls = element('div', 'yt-table300__controls');
    var fieldLabel = element('label', 'yt-table300__control');
    fieldLabel.appendChild(element('span', '', 'Свойство'));
    var fieldSelect = element('select', 'yt-table300__field');
    fieldSelect.setAttribute('aria-label', 'Свойство для изменения');
    fieldLabel.appendChild(fieldSelect);
    var valueLabel = element('label', 'yt-table300__control');
    valueLabel.appendChild(element('span', '', 'Новое значение'));
    var valueSelect = element('select', 'yt-table300__value');
    valueSelect.setAttribute('aria-label', 'Новое значение');
    valueLabel.appendChild(valueSelect);
    var applyButton = element('button', 'yt-table300__apply', 'Применить');
    applyButton.type = 'submit';
    formControls.appendChild(fieldLabel);
    formControls.appendChild(valueLabel);
    formControls.appendChild(applyButton);
    var hint = element('p', 'yt-table300__hint', 'Выберите записи, свойство и значение. Несовместимые записи будут пропущены.');
    var progress = element('p', 'yt-table300__progress', '');
    progress.setAttribute('role', 'status');
    progress.setAttribute('aria-live', 'polite');
    var feedback = element('div', 'yt-table300__feedback');
    feedback.setAttribute('role', 'status');
    feedback.setAttribute('aria-live', 'polite');
    var feedbackTitle = element('p', 'yt-table300__feedback-title', '');
    var stats = element('div', 'yt-table300__stats');
    function statistic(title, className) {
      var box = element('div', 'yt-table300__stat');
      box.appendChild(element('span', 'yt-table300__stat-label', title));
      var number = element('strong', className, '0');
      box.appendChild(number);
      stats.appendChild(box);
      return number;
    }
    var appliedCount = statistic('Обработано', 'yt-table300__applied');
    var skippedCount = statistic('Пропущено', 'yt-table300__skipped');
    var failedCount = statistic('Ошибки', 'yt-table300__failed');
    var errorText = element('p', 'yt-table300__error', '');
    errorText.setAttribute('role', 'alert');
    feedback.appendChild(feedbackTitle);
    feedback.appendChild(stats);
    feedback.appendChild(errorText);
    feedback.hidden = true;
    form.appendChild(formHeading);
    form.appendChild(formControls);
    form.appendChild(hint);
    form.appendChild(progress);
    form.appendChild(feedback);
    root.replaceChildren(heading, selectionNote, scroll, form);

    function storeFocus() {
      var active = doc.activeElement;
      if (active === allCheckbox) return { kind: 'all' };
      if (active === fieldSelect) return { kind: 'field' };
      if (active === valueSelect) return { kind: 'value' };
      if (active === applyButton) return { kind: 'apply' };
      if (active && active.classList && active.classList.contains('yt-table300__row-select')) {
        return { kind: 'row', id: active.dataset.entryId };
      }
      return null;
    }

    function restoreFocus(where) {
      if (!where) return;
      var target = null;
      if (where.kind === 'all') target = allCheckbox;
      if (where.kind === 'field') target = fieldSelect;
      if (where.kind === 'value') target = valueSelect;
      if (where.kind === 'apply') target = applyButton;
      if (where.kind === 'row') {
        target = Array.from(tbody.querySelectorAll('.yt-table300__row-select')).find(function (checkbox) {
          return checkbox.dataset.entryId === where.id;
        });
      }
      if (target && !target.disabled && target.isConnected) target.focus({ preventScroll: true });
    }

    function updateSelectionState() {
      var all = entries.length;
      var selected = selectedEntries().length;
      setAccessibleText(selectionNote, 'Выбрано: ' + selected + ' из ' + all);
      allCheckbox.checked = all > 0 && selected === all;
      allCheckbox.indeterminate = selected > 0 && selected < all;
      allCheckbox.setAttribute('aria-checked', allCheckbox.indeterminate ? 'mixed' : String(allCheckbox.checked));
      allCheckbox.disabled = pending || all === 0;
      Array.from(tbody.querySelectorAll('.yt-table300__row-select')).forEach(function (checkbox) {
        checkbox.checked = selectedIds.has(checkbox.dataset.entryId);
        checkbox.disabled = pending;
      });
      fieldSelect.disabled = pending || selected === 0;
      valueSelect.disabled = pending || selected === 0 || !selectedField() || selectedField().options.length === 0;
      applyButton.disabled = pending || selected === 0 || !selectedField() || !selectedOption();
      applyButton.textContent = pending ? 'Сохраняем…' : 'Применить';
    }

    function rebuildFields() {
      var previousKey = selectedField() && selectedField().key;
      var selectedTypes = new Set(selectedEntries().map(function (entry) { return entry.type; }));
      fieldSelect.replaceChildren();
      var placeholder = element('option', '', 'Выберите свойство');
      placeholder.value = '';
      fieldSelect.appendChild(placeholder);
      var hasField = false;
      kindOrder.forEach(function (kind) {
        var group = element('optgroup');
        group.label = kind;
        fields.forEach(function (field, index) {
          if (fieldGroup(field) !== kind) return;
          var option = element('option', '', field.label + fieldQualifier(field));
          option.value = String(index);
          option.dataset.fieldKey = field.key;
          option.disabled = !field.types.some(function (type) { return selectedTypes.has(type); });
          if (!option.disabled) hasField = true;
          group.appendChild(option);
        });
        if (group.childNodes.length) fieldSelect.appendChild(group);
      });
      var restored = fields.findIndex(function (field) {
        return field.key === previousKey && field.types.some(function (type) { return selectedTypes.has(type); });
      });
      currentFieldIndex = restored;
      fieldSelect.value = restored >= 0 ? String(restored) : '';
      if (!hasField) currentFieldIndex = -1;
      rebuildValues();
    }

    function rebuildValues() {
      var previousValue = selectedOption() && selectedOption().value;
      valueSelect.replaceChildren();
      var placeholder = element('option', '', 'Выберите значение');
      placeholder.value = '';
      valueSelect.appendChild(placeholder);
      var field = selectedField();
      currentOptionIndex = -1;
      if (field) {
        field.options.forEach(function (option, index) {
          var node = element('option', '', option.label);
          node.value = String(index);
          node.dataset.rawValue = option.value;
          valueSelect.appendChild(node);
          if (previousValue === option.value) currentOptionIndex = index;
        });
      }
      valueSelect.value = currentOptionIndex >= 0 ? String(currentOptionIndex) : '';
      updateSelectionState();
    }

    function renderRows() {
      var validIds = new Set(entries.map(function (entry) { return entry.id; }));
      Array.from(selectedIds).forEach(function (id) {
        if (!validIds.has(id)) selectedIds.delete(id);
      });
      var fragment = doc.createDocumentFragment();
      entries.forEach(function (entry) {
        var tr = element('tr', 'yt-table300__row');
        var selectionCell = element('td');
        var checkboxLabel = element('label', 'yt-table300__check-label');
        var checkbox = element('input', 'yt-table300__row-select');
        checkbox.type = 'checkbox';
        checkbox.dataset.entryId = entry.id;
        checkbox.checked = selectedIds.has(entry.id);
        checkbox.disabled = pending;
        checkbox.setAttribute('aria-label', 'Выбрать: ' + entry.title + ' (' + (typeNames[entry.type] || entry.type) + ')');
        checkbox.addEventListener('change', function () {
          if (pending || destroyed) return;
          if (checkbox.checked) selectedIds.add(entry.id);
          else selectedIds.delete(entry.id);
          rebuildFields();
        });
        checkboxLabel.appendChild(checkbox);
        checkboxLabel.appendChild(element('span', 'yt-table300__sr-only', 'Выбрать ' + entry.title));
        selectionCell.appendChild(checkboxLabel);
        tr.appendChild(selectionCell);
        var titleCell = element('th', 'yt-table300__title', entry.title);
        titleCell.scope = 'row';
        tr.appendChild(titleCell);
        tr.appendChild(element('td', 'yt-table300__type', typeNames[entry.type] || entry.type));
        fields.forEach(function (field) {
          var cell = element('td', 'yt-table300__cell');
          if (!availableFor(field, entry.type)) {
            cell.classList.add('yt-table300__cell--na');
            cell.appendChild(element('span', 'yt-table300__na-symbol', '—'));
            cell.appendChild(element('span', 'yt-table300__sr-only',
              'Не применяется к типу «' + (typeNames[entry.type] || entry.type) + '»'));
          } else if (!Object.prototype.hasOwnProperty.call(entry.values, field.key) ||
                     entry.values[field.key] === '') {
            cell.classList.add('yt-table300__cell--empty');
            cell.appendChild(element('span', '', 'Не задано'));
          } else {
            var raw = entry.values[field.key];
            var known = field.options.find(function (option) { return option.value === raw; });
            cell.textContent = known ? known.label : raw;
          }
          tr.appendChild(cell);
        });
        fragment.appendChild(tr);
      });
      tbody.replaceChildren(fragment);
      updateSelectionState();
    }

    function showResult(title, applied, skipped, failed, error) {
      feedback.hidden = false;
      feedbackTitle.textContent = title;
      appliedCount.textContent = String(applied);
      skippedCount.textContent = String(skipped);
      failedCount.textContent = String(failed);
      errorText.textContent = error || '';
    }

    function validateResult(result) {
      if (!result || !Array.isArray(result.entries) ||
          !['applied', 'skipped', 'failed'].every(function (key) {
            return Number.isSafeInteger(result[key]) && result[key] >= 0;
          })) {
        throw new Error('Некорректный ответ сохранения: ожидаются entries и неотрицательные счётчики.');
      }
      var ids = new Set();
      result.entries.forEach(function (entry) {
        if (!entry || typeof entry.id !== 'string' || ids.has(entry.id) ||
            !Object.prototype.hasOwnProperty.call(typeNames, entry.type) ||
            typeof entry.title !== 'string' || !entry.values || typeof entry.values !== 'object') {
          throw new Error('Некорректный снимок таблицы после сохранения.');
        }
        ids.add(entry.id);
      });
      return result;
    }

    allCheckbox.addEventListener('change', function () {
      if (pending || destroyed) return;
      if (allCheckbox.checked) entries.forEach(function (entry) { selectedIds.add(entry.id); });
      else selectedIds.clear();
      rebuildFields();
    });

    fieldSelect.addEventListener('change', function () {
      if (pending || destroyed) return;
      var index = fieldSelect.value === '' ? -1 : Number(fieldSelect.value);
      currentFieldIndex = Number.isInteger(index) && index >= 0 && index < fields.length &&
        !fieldSelect.selectedOptions[0].disabled ? index : -1;
      currentOptionIndex = -1;
      rebuildValues();
    });

    valueSelect.addEventListener('change', function () {
      if (pending || destroyed) return;
      var field = selectedField();
      var index = valueSelect.value === '' ? -1 : Number(valueSelect.value);
      currentOptionIndex = field && Number.isInteger(index) && index >= 0 &&
        index < field.options.length ? index : -1;
      updateSelectionState();
    });

    form.addEventListener('submit', async function (event) {
      event.preventDefault();
      if (pending || destroyed) return;
      var field = selectedField();
      var option = selectedOption();
      var ids = selectedEntries().map(function (entry) { return entry.id; });
      if (!ids.length || !field || !option ||
          !ids.some(function (id) {
            var row = entries.find(function (entry) { return entry.id === id; });
            return row && availableFor(field, row.type);
          })) return;

      var focusBefore = storeFocus();
      pending = true;
      progress.textContent = 'Сохраняем изменения…';
      feedback.hidden = true;
      updateSelectionState();
      try {
        var result = validateResult(await config.onApply({
          ids: ids,
          key: field.key,
          value: option.value
        }));
        if (destroyed) return;
        entries = copyEntries(result.entries);
        showResult('Сохранение завершено', result.applied, result.skipped,
          result.failed, result.failed > 0 ? 'Часть записей не удалось обработать.' : '');
        renderRows();
        rebuildFields();
      } catch (error) {
        if (destroyed) return;
        showResult('Сохранение не подтверждено', '—', '—', '—',
          'Причина: ' + (error && error.message ? error.message : String(error)) +
          '. Состояние записей неизвестно; повтор доступен.');
      } finally {
        if (!destroyed) {
          pending = false;
          progress.textContent = '';
          updateSelectionState();
          restoreFocus(focusBefore);
        }
      }
    });

    renderRows();
    rebuildFields();
    return {
      destroy: function () {
        if (destroyed) return;
        destroyed = true;
        root.replaceChildren();
        if (addedClass) root.classList.remove('yt-table300');
      }
    };
  }

  window.mountYoutubeTable300 = mountYoutubeTable300;
}());