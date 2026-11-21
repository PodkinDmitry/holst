/* XOD YouTube Table 300 — dependency-free browser component.
 * Public API: window.mountYoutubeTable300(root, { entries, fields, onApply })
 * No persistence or network access is performed by this component.
 */
(function () {
  'use strict';


  // Pure, DOM-free view engine. The input records, fields and view are never mutated.
  function computeYoutubeTable300View(entries, fields, view) {
    var definitions = new Map(fields.map(function (field) { return [field.key, field]; }));
    var filter = view && view.filter || null;
    var sorting = view && Array.isArray(view.sort) ? view.sort : [];

    function applicable(entry, field) {
      return !!field && Array.isArray(field.types) && field.types.indexOf(entry.type) !== -1;
    }

    function matches(entry, node, depth) {
      if (!node || typeof node !== 'object' || depth > 24) return false;
      if (Array.isArray(node.children)) {
        if (node.op === 'and') return node.children.every(function (child) { return matches(entry, child, depth + 1); });
        if (node.op === 'or') return node.children.some(function (child) { return matches(entry, child, depth + 1); });
        return false;
      }
      var field = definitions.get(node.key);
      if (!applicable(entry, field)) return false;
      var raw = Object.prototype.hasOwnProperty.call(entry.values || {}, node.key)
        ? entry.values[node.key] : '';
      var populated = typeof raw === 'string' && raw.length > 0;
      if (node.op === 'set') return populated;
      if (node.op === 'unset') return !populated;
      if (node.op === 'eq') return populated && raw === node.value;
      return false;
    }

    function orderValue(entry, rule) {
      var field = definitions.get(rule.key);
      if (!applicable(entry, field)) return { tier: 2, rank: 0, raw: '' };
      var raw = Object.prototype.hasOwnProperty.call(entry.values || {}, rule.key)
        ? entry.values[rule.key] : '';
      if (typeof raw !== 'string' || raw === '') return { tier: 1, rank: 0, raw: '' };
      var index = (field.options || []).findIndex(function (option) { return option.value === raw; });
      return { tier: 0, rank: index < 0 ? (field.options || []).length : index, raw: raw };
    }

    return entries.map(function (entry, index) { return { entry: entry, index: index }; })
      .filter(function (item) { return !filter || matches(item.entry, filter, 0); })
      .sort(function (left, right) {
        for (var i = 0; i < sorting.length; i++) {
          var rule = sorting[i];
          if (!rule || !definitions.has(rule.key)) continue;
          var a = orderValue(left.entry, rule);
          var b = orderValue(right.entry, rule);
          // Defined -> empty -> inapplicable, even for descending sort.
          if (a.tier !== b.tier) return a.tier - b.tier;
          if (a.tier !== 0) continue;
          var comparison = a.rank - b.rank;
          if (!comparison && a.raw !== b.raw) comparison = a.raw < b.raw ? -1 : 1;
          if (comparison) return rule.dir === 'desc' ? -comparison : comparison;
        }
        return left.index - right.index;
      })
      .map(function (item) { return item.entry; });
  }

  // CHAT 04 — pure grouping engine. The source records and view are never changed.
  // A group is derived from already-filtered/sorted rows and identified by a stable value key.
  function computeYoutubeTable300Groups(entries, fields, view) {
    var ordered = computeYoutubeTable300View(entries, fields, view);
    var rule = view && view.group;
    var field = rule && fields.find(function (item) { return item.key === rule.key; });
    if (!field) {
      return [{id:'__all__',kind:'all',label:'Все записи',entries:ordered}];
    }
    var buckets = new Map();
    ordered.forEach(function (entry) {
      var applicable = Array.isArray(field.types) && field.types.indexOf(entry.type) !== -1;
      var raw = applicable && entry.values && Object.prototype.hasOwnProperty.call(entry.values, field.key)
        ? entry.values[field.key] : '';
      var kind = !applicable ? 'na' : (typeof raw !== 'string' || !raw ? 'empty' : 'value');
      var value = kind === 'value' ? raw : '';
      var id = JSON.stringify([field.key, kind, value]);
      if (!buckets.has(id)) {
        var optionIndex = kind === 'value' ? (field.options || []).findIndex(function (item) {
          return item.value === value;
        }) : -1;
        var option = optionIndex >= 0 ? field.options[optionIndex] : null;
        buckets.set(id, {id:id,kind:kind,key:field.key,value:value,
          label:kind === 'na' ? 'Неприменимо' : (kind === 'empty' ? 'Не задано' : (option ? option.label : value)),
          rank:kind !== 'value' ? 0 : (optionIndex >= 0 ? optionIndex : (field.options || []).length),
          entries:[]});
      }
      buckets.get(id).entries.push(entry);
    });
    var descending = rule.dir === 'desc';
    var groupOrder = {value:0,empty:1,na:2};
    return Array.from(buckets.values()).sort(function (a,b) {
      var tier = groupOrder[a.kind] - groupOrder[b.kind];
      if (tier) return tier;
      if (a.kind !== 'value') return 0;
      var index = a.rank - b.rank;
      if (!index && a.value !== b.value) index = a.value < b.value ? -1 : 1;
      return descending ? -index : index;
    });
  }

  function normalizeYoutubeTable300View(value) {
    function node(source, depth) {
      if (!source || typeof source !== 'object' || depth > 16) return null;
      if (Array.isArray(source.children)) {
        return { op: source.op === 'or' ? 'or' : 'and',
          children: source.children.map(function (part) { return node(part, depth + 1); }).filter(Boolean) };
      }
      if (typeof source.key !== 'string') return null;
      return { key: source.key, op: ['eq','set','unset'].indexOf(source.op) >= 0 ? source.op : 'eq',
        ...(source.op === 'eq' ? { value: String(source.value === undefined ? '' : source.value) } : {}) };
    }
    var filter = value && value.filter ? node(value.filter, 0) : null;
    // Accept a legacy single-condition root by wrapping it into a normal group.
    if (filter && !Array.isArray(filter.children)) filter = {op:'and',children:[filter]};
    var result = { filter: filter,
      sort: value && Array.isArray(value.sort) ? value.sort.filter(function (item) {
        return item && typeof item.key === 'string';
      }).map(function (item) { return { key: item.key, dir: item.dir === 'desc' ? 'desc' : 'asc' }; }) : [] };
    // Optional field. Old consumers without group keep their exact CHAT 03 view shape.
    if (value && Object.prototype.hasOwnProperty.call(value,'group')) {
      var group = value.group;
      result.group = group && typeof group.key === 'string' && group.key
        ? {key:group.key,dir:group.dir === 'desc' ? 'desc' : 'asc'} : null;
    }
    return result;
  }

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
    var view = normalizeYoutubeTable300View(config.view);
    var collapsedGroupIds = new Set(); // Local UI state, not persisted with the view.
    var displayedGroups = computeYoutubeTable300Groups(entries, fields, view);
    var visibleEntries = displayedGroups.reduce(function (list, group) {
      if (!collapsedGroupIds.has(group.id)) group.entries.forEach(function (entry) { list.push(entry); });
      return list;
    }, []);
    // CHAT 03 — named view presets. Never mix presets with entry.values.
    var hasPresets = Array.isArray(config.presets) || typeof config.onChangePreset === 'function';
    var presets = Array.isArray(config.presets) ? config.presets.map(function (item) {
      return { id: item.id, name: item.name, view: normalizeYoutubeTable300View(item.view) };
    }) : [];
    var chosenPresetId = '';
    var presetPending = false;
    var retryPresetCommand = null;
    var saveRevision = 0;
    var saveChain = Promise.resolve();
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
      return visibleEntries.filter(function (entry) { return selectedIds.has(entry.id); });
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


    // View settings, independent of persistence (owned by Sol).
    var viewPanel = element('details', 'yt-table300__view');
    var viewSummary = element('summary', 'yt-table300__view-summary', 'Настройки вида: фильтры и сортировка');
    var viewContent = element('div', 'yt-table300__view-content');
    var filterHeading = element('h3', 'yt-table300__view-title', 'Фильтры');
    var filterEditor = element('div', 'yt-table300__filter-editor');
    var sortHeading = element('h3', 'yt-table300__view-title', 'Сортировка');
    var sortEditor = element('div', 'yt-table300__sort-editor');
    var groupingHeading = element('h3', 'yt-table300__view-title', 'Группировка');
    var groupingEditor = element('div', 'yt-table300__grouping-editor');
    var viewStatus = element('p', 'yt-table300__view-status', '');
    viewStatus.setAttribute('role', 'status');
    viewStatus.setAttribute('aria-live', 'polite');
    var viewRetry = element('button', 'yt-table300__view-retry', 'Повторить сохранение вида');
    viewRetry.type = 'button';
    viewRetry.hidden = true;
    viewContent.append(filterHeading, filterEditor, sortHeading, sortEditor,
      groupingHeading, groupingEditor, viewStatus, viewRetry);
    viewPanel.append(viewSummary, viewContent);


    // Optional presets panel; absent entirely for CHAT 02 consumers.
    var presetPanel = null;
    var presetSelect, presetName, presetApply, presetCreate, presetUpdate, presetRename, presetDelete;
    var presetStatus, presetRetry, presetEmpty;
    if (hasPresets) {
      presetPanel = element('section', 'yt-table300__presets');
      presetPanel.setAttribute('aria-label', 'Сохранённые пресеты вида');
      presetPanel.appendChild(element('h3', 'yt-table300__preset-heading', 'Пресеты вида'));
      var presetControls = element('div', 'yt-table300__preset-controls');
      var presetSelectLabel = element('label', 'yt-table300__preset-control');
      presetSelectLabel.appendChild(element('span', '', 'Сохранённый пресет'));
      presetSelect = element('select', 'yt-table300__preset-select');
      presetSelect.setAttribute('aria-label', 'Сохранённый пресет вида');
      presetSelectLabel.appendChild(presetSelect);
      presetControls.appendChild(presetSelectLabel);
      var presetNameLabel = element('label', 'yt-table300__preset-control');
      presetNameLabel.appendChild(element('span', '', 'Название пресета'));
      presetName = element('input', 'yt-table300__preset-name');
      presetName.type = 'text';
      presetName.maxLength = 100;
      presetName.setAttribute('aria-label', 'Название пресета вида');
      presetNameLabel.appendChild(presetName);
      presetControls.appendChild(presetNameLabel);
      var presetButtons = element('div', 'yt-table300__preset-actions');
      function presetButton(className, label) {
        var button = element('button', 'yt-table300__preset-button ' + className, label);
        button.type = 'button';
        presetButtons.appendChild(button);
        return button;
      }
      presetApply = presetButton('yt-table300__preset-apply', 'Применить');
      presetCreate = presetButton('yt-table300__preset-create', 'Сохранить новый');
      presetUpdate = presetButton('yt-table300__preset-update', 'Обновить текущим видом');
      presetRename = presetButton('yt-table300__preset-rename', 'Переименовать');
      presetDelete = presetButton('yt-table300__preset-delete', 'Удалить');
      presetStatus = element('p', 'yt-table300__preset-status', '');
      presetStatus.setAttribute('role', 'status');
      presetStatus.setAttribute('aria-live', 'polite');
      presetEmpty = element('p', 'yt-table300__preset-empty', 'Сохранённых пресетов пока нет.');
      presetRetry = element('button', 'yt-table300__preset-button yt-table300__preset-retry', 'Повторить запись пресета');
      presetRetry.type = 'button';
      presetRetry.hidden = true;
      presetPanel.append(presetControls, presetButtons, presetEmpty, presetStatus, presetRetry);
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
    root.replaceChildren(heading, viewPanel, selectionNote, scroll, form);
    if (presetPanel) root.insertBefore(presetPanel, viewPanel);

    function storeFocus() {
      var active = doc.activeElement;
      if (active === allCheckbox) return { kind: 'all' };
      if (active === fieldSelect) return { kind: 'field' };
      if (active === valueSelect) return { kind: 'value' };
      if (active === applyButton) return { kind: 'apply' };
      if (active && active.classList && active.classList.contains('yt-table300__group-toggle')) {
        return {kind:'group',id:active.dataset.groupId};
      }
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
      if (where.kind === 'group') {
        target = Array.from(tbody.querySelectorAll('.yt-table300__group-toggle')).find(function (button) {
          return button.dataset.groupId === where.id;
        });
      }
      if (where.kind === 'row') {
        target = Array.from(tbody.querySelectorAll('.yt-table300__row-select')).find(function (checkbox) {
          return checkbox.dataset.entryId === where.id;
        });
      }
      if (target && !target.disabled && target.isConnected) target.focus({ preventScroll: true });
    }

    function updateSelectionState() {
      var all = visibleEntries.length;
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
      var validIds = new Set(visibleEntries.map(function (entry) { return entry.id; }));
      Array.from(selectedIds).forEach(function (id) {
        if (!validIds.has(id)) selectedIds.delete(id);
      });
      var fragment = doc.createDocumentFragment();
      function renderRecord(entry) {
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
        return tr;
      }
      var activeGroupRule = view.group && fields.some(function (field) {
        return field.key === view.group.key;
      });
      if (activeGroupRule) {
        displayedGroups.forEach(function (group) {
          var collapsed = collapsedGroupIds.has(group.id);
          var header = element('tr', 'yt-table300__group-header');
          var cell = element('th', 'yt-table300__group-cell');
          cell.scope = 'row';
          cell.colSpan = 3 + fields.length;
          var toggle = element('button', 'yt-table300__group-toggle');
          toggle.type = 'button';
          toggle.dataset.groupId = group.id;
          toggle.setAttribute('aria-expanded', String(!collapsed));
          toggle.setAttribute('aria-label', (collapsed ? 'Развернуть' : 'Свернуть') +
            ' группу ' + group.label + ', записей: ' + group.entries.length);
          toggle.appendChild(element('span', 'yt-table300__group-chevron', collapsed ? '▸' : '▾'));
          toggle.appendChild(element('span', 'yt-table300__group-name', group.label));
          toggle.appendChild(element('span', 'yt-table300__group-count', String(group.entries.length)));
          toggle.addEventListener('click', function () {
            if (pending || destroyed) return;
            if (collapsedGroupIds.has(group.id)) collapsedGroupIds.delete(group.id);
            else collapsedGroupIds.add(group.id);
            calculateDisplayedGroups();
            renderRows();
            rebuildFields();
            restoreFocus({kind:'group',id:group.id});
          });
          cell.appendChild(toggle);
          header.appendChild(cell);
          fragment.appendChild(header);
          if (!collapsed) group.entries.forEach(function (entry) {
            fragment.appendChild(renderRecord(entry));
          });
        });
      } else visibleEntries.forEach(function (entry) {
        fragment.appendChild(renderRecord(entry));
      });
      tbody.replaceChildren(fragment);
      updateSelectionState();
    }


    function calculateDisplayedGroups() {
      displayedGroups = computeYoutubeTable300Groups(entries, fields, view);
      var groupIds = new Set(displayedGroups.map(function (group) { return group.id; }));
      Array.from(collapsedGroupIds).forEach(function (id) {
        if (!groupIds.has(id)) collapsedGroupIds.delete(id);
      });
      visibleEntries = displayedGroups.reduce(function (rows, group) {
        if (!collapsedGroupIds.has(group.id)) group.entries.forEach(function (entry) { rows.push(entry); });
        return rows;
      }, []);
    }

    function refreshFromView() {
      var focusBefore = storeFocus();
      calculateDisplayedGroups();
      renderRows(); // Prunes selected IDs of hidden or collapsed records.
      rebuildFields();
      restoreFocus(focusBefore);
    }

    function saveView() {
      if (typeof config.onSaveView !== 'function') return;
      var revision = ++saveRevision;
      var snapshot = normalizeYoutubeTable300View(view);
      viewRetry.hidden = true;
      viewStatus.textContent = 'Сохраняем настройки вида…';
      // Serialize requests to prevent an old response from overwriting a newer view in the host.
      saveChain = saveChain.catch(function () {}).then(function () {
        return config.onSaveView(snapshot);
      }).then(function () {
        if (destroyed || revision !== saveRevision) return;
        viewStatus.textContent = 'Настройки вида сохранены.';
        viewRetry.hidden = true;
      }).catch(function (error) {
        if (destroyed || revision !== saveRevision) return;
        viewStatus.textContent = 'Не удалось сохранить вид: ' +
          (error && error.message ? error.message : String(error)) + '. Текущие настройки сохранены в открытой таблице.';
        viewRetry.hidden = false;
      });
    }

    function updateView(refocus) {
      refreshFromView();
      renderViewControls();
      if (refocus) {
        var target = Array.from(viewPanel.querySelectorAll('[data-view-focus]')).find(function (el) {
          return el.dataset.viewFocus === refocus;
        });
        if (target) target.focus({ preventScroll: true });
      }
      saveView();
    }

    function makeControl(options, current, css, label) {
      var control = element('select', css);
      control.setAttribute('aria-label', label);
      options.forEach(function (item) {
        var opt = element('option', '', item.label);
        opt.value = item.value;
        control.appendChild(opt);
      });
      control.value = current;
      return control;
    }

    function fieldChoices() {
      return fields.map(function (field) { return { value: field.key, label: field.label + fieldQualifier(field) }; });
    }

    function groupAt(path) {
      var group = view.filter;
      path.forEach(function (part) { group = group.children[part]; });
      return group;
    }

    function filterGroup(group, path) {
      var slug = 'group-' + path.join('-');
      var holder = element('div', 'yt-table300__group');
      var toolbar = element('div', 'yt-table300__view-row');
      toolbar.appendChild(element('span', 'yt-table300__group-label', path.length ? 'Вложенная группа' : 'Группа условий'));
      var combine = makeControl([{value:'and',label:'И — все условия'}, {value:'or',label:'ИЛИ — любое условие'}],
        group.op, 'yt-table300__group-op', 'Объединение условий');
      combine.dataset.viewFocus = slug + '-op';
      combine.addEventListener('change', function () {
        group.op = combine.value;
        updateView(slug + '-op');
      });
      toolbar.appendChild(combine);
      var addRule = element('button', 'yt-table300__view-button yt-table300__add-rule', 'Добавить условие');
      addRule.type = 'button';
      addRule.dataset.viewFocus = slug + '-add';
      addRule.addEventListener('click', function () {
        if (!fields.length) return;
        var first = fields[0];
        group.children.push({key:first.key,op:'eq',value:first.options[0] ? first.options[0].value : ''});
        updateView(slug + '-add');
      });
      toolbar.appendChild(addRule);
      var addGroup = element('button', 'yt-table300__view-button yt-table300__add-group', 'Добавить вложенную группу');
      addGroup.type = 'button';
      addGroup.addEventListener('click', function () {
        group.children.push({op:'and',children:[]});
        updateView(slug + '-add');
      });
      toolbar.appendChild(addGroup);
      var removeGroup = element('button', 'yt-table300__view-button', 'Удалить группу');
      removeGroup.type = 'button';
      removeGroup.addEventListener('click', function () {
        if (path.length === 0) view.filter = null;
        else groupAt(path.slice(0,-1)).children.splice(path[path.length-1],1);
        updateView();
      });
      toolbar.appendChild(removeGroup);
      holder.appendChild(toolbar);
      group.children.forEach(function (child, index) {
        var childPath = path.concat(index);
        if (Array.isArray(child.children)) {
          holder.appendChild(filterGroup(child, childPath));
          return;
        }
        var row = element('div', 'yt-table300__view-row yt-table300__rule');
        var prefix = 'rule-' + childPath.join('-');
        var keySelect = makeControl(fieldChoices(), child.key, 'yt-table300__rule-key', 'Свойство фильтра');
        keySelect.dataset.viewFocus = prefix + '-field';
        keySelect.addEventListener('change', function () {
          child.key = keySelect.value;
          var targetField = fieldByKey.get(child.key);
          if (child.op === 'eq') child.value = targetField && targetField.options[0] ? targetField.options[0].value : '';
          updateView(prefix + '-field');
        });
        row.appendChild(keySelect);
        var opSelect = makeControl([
          {value:'eq',label:'Равно'}, {value:'set',label:'Есть значение'}, {value:'unset',label:'Не задано'}
        ],child.op,'yt-table300__rule-operator','Условие фильтра');
        opSelect.dataset.viewFocus = prefix + '-op';
        opSelect.addEventListener('change', function () {
          child.op = opSelect.value;
          if (child.op === 'eq') {
            var activeField = fieldByKey.get(child.key);
            child.value = activeField && activeField.options[0] ? activeField.options[0].value : '';
          } else delete child.value;
          updateView(prefix + '-op');
        });
        row.appendChild(opSelect);
        if (child.op === 'eq') {
          var definition = fieldByKey.get(child.key);
          var choices = definition ? (definition.options || []).map(function (o) { return {value:o.value,label:o.label}; }) : [];
          var valueSelect = makeControl(choices, child.value, 'yt-table300__rule-value','Значение фильтра');
          valueSelect.dataset.viewFocus = prefix + '-value';
          if (!choices.length) valueSelect.disabled = true;
          valueSelect.addEventListener('change', function () {
            child.value = valueSelect.value;
            updateView(prefix + '-value');
          });
          row.appendChild(valueSelect);
        }
        var remove = element('button', 'yt-table300__view-button', 'Удалить условие');
        remove.type = 'button';
        remove.addEventListener('click', function () {
          group.children.splice(index,1);
          updateView(slug + '-add');
        });
        row.appendChild(remove);
        holder.appendChild(row);
      });
      return holder;
    }

    function renderViewControls() {
      filterEditor.replaceChildren();
      if (!view.filter) {
        filterEditor.appendChild(element('p', 'yt-table300__view-empty', 'Фильтры выключены.'));
        var create = element('button', 'yt-table300__view-button yt-table300__create-filter', 'Добавить группу фильтров');
        create.type = 'button';
        create.addEventListener('click', function () {
          view.filter = {op:'and',children:[]};
          updateView('group--add');
        });
        filterEditor.appendChild(create);
      } else {
        filterEditor.appendChild(filterGroup(view.filter, []));
      }
      sortEditor.replaceChildren();
      view.sort.forEach(function (rule, index) {
        var row = element('div','yt-table300__view-row yt-table300__sort-row');
        var key = makeControl(fieldChoices(),rule.key,'yt-table300__sort-key','Поле сортировки ' + (index+1));
        key.dataset.viewFocus = 'sort-' + index + '-field';
        key.addEventListener('change',function () { rule.key = key.value; updateView('sort-' + index + '-field'); });
        row.appendChild(key);
        var direction = makeControl([{value:'asc',label:'По возрастанию'}, {value:'desc',label:'По убыванию'}],
          rule.dir, 'yt-table300__sort-dir', 'Направление сортировки ' + (index+1));
        direction.dataset.viewFocus = 'sort-' + index + '-dir';
        direction.addEventListener('change', function () { rule.dir = direction.value; updateView('sort-' + index + '-dir'); });
        row.appendChild(direction);
        ['up','down'].forEach(function (move) {
          var up = move === 'up';
          var button = element('button','yt-table300__view-button yt-table300__sort-move',up ? '↑ Выше' : '↓ Ниже');
          button.type = 'button';
          button.disabled = up ? index === 0 : index === view.sort.length - 1;
          button.setAttribute('aria-label',(up ? 'Повысить' : 'Понизить') + ' приоритет сортировки ' + (index+1));
          button.addEventListener('click', function () {
            var other = up ? index - 1 : index + 1;
            var previous = view.sort[index];
            view.sort[index] = view.sort[other];
            view.sort[other] = previous;
            updateView('sort-' + other + '-field');
          });
          row.appendChild(button);
        });
        var deleteRule = element('button','yt-table300__view-button','Удалить сортировку');
        deleteRule.type = 'button';
        deleteRule.addEventListener('click',function () { view.sort.splice(index,1); updateView('sort-add'); });
        row.appendChild(deleteRule);
        sortEditor.appendChild(row);
      });
      var addSort = element('button','yt-table300__view-button yt-table300__sort-add','Добавить поле сортировки');
      addSort.type = 'button';
      addSort.dataset.viewFocus = 'sort-add';
      addSort.disabled = fields.length === 0;
      addSort.addEventListener('click',function () {
        var next = fields.find(function (field) { return !view.sort.some(function (rule) {return rule.key === field.key;}); });
        if (!next) return;
        view.sort.push({key:next.key,dir:'asc'});
        updateView('sort-' + (view.sort.length-1) + '-field');
      });
      if (view.sort.length >= fields.length) addSort.disabled = true;
      sortEditor.appendChild(addSort);
      // Grouping is independent from sorting. Multiple sort keys still order rows inside groups.
      groupingEditor.replaceChildren();
      var groupRow = element('div', 'yt-table300__view-row');
      var groupSelect = makeControl([{value:'',label:'Без группировки'}].concat(fieldChoices()),
        view.group && fields.some(function (field) { return field.key === view.group.key; })
          ? view.group.key : '', 'yt-table300__grouping-field', 'Группировать по свойству');
      groupSelect.dataset.viewFocus = 'grouping-field';
      groupSelect.addEventListener('change', function () {
        // Clearing grouping must be saved as explicit null even if initial view lacked the key.
        view.group = groupSelect.value ? {key:groupSelect.value,dir:'asc'} : null;
        collapsedGroupIds.clear();
        updateView('grouping-field');
      });
      groupRow.appendChild(groupSelect);
      if (view.group && view.group.key && fields.some(function (field) {return field.key === view.group.key;})) {
        var groupDirection = makeControl([
          {value:'asc',label:'По порядку опций'},
          {value:'desc',label:'В обратном порядке'}
        ], view.group.dir, 'yt-table300__grouping-direction', 'Порядок групп');
        groupDirection.dataset.viewFocus = 'grouping-dir';
        groupDirection.addEventListener('change', function () {
          view.group.dir = groupDirection.value;
          updateView('grouping-dir');
        });
        groupRow.appendChild(groupDirection);
      }
      groupingEditor.appendChild(groupRow);
    }

    viewRetry.addEventListener('click', saveView);
    renderViewControls();



    // CHAT 03 — reusable preset UI. Only writes to the host through an explicit adapter.
    function safePresetError(error) {
      return error && error.message ? error.message : String(error);
    }

    function renderPresets() {
      if (!presetPanel || destroyed) return;
      var previous = chosenPresetId;
      presetSelect.replaceChildren();
      var placeholder = element('option', '', 'Выберите пресет');
      placeholder.value = '';
      presetSelect.appendChild(placeholder);
      presets.forEach(function (item) {
        var option = element('option', '', item.name);
        option.value = item.id;
        presetSelect.appendChild(option);
      });
      chosenPresetId = presets.some(function (p) { return p.id === previous; }) ? previous : '';
      presetSelect.value = chosenPresetId;
      var hasChoice = !!chosenPresetId;
      var writable = typeof config.onChangePreset === 'function';
      var nameValid = presetName.value.trim().length > 0;
      presetSelect.disabled = presetPending || pending || presets.length === 0;
      presetName.disabled = presetPending || pending || !writable;
      presetApply.disabled = presetPending || pending || !hasChoice;
      presetCreate.disabled = presetPending || pending || !writable || !nameValid;
      presetUpdate.disabled = presetPending || pending || !writable || !hasChoice;
      presetRename.disabled = presetPending || pending || !writable || !hasChoice || !nameValid;
      presetDelete.disabled = presetPending || pending || !writable || !hasChoice;
      presetRetry.hidden = !retryPresetCommand || presetPending || !writable;
      presetEmpty.hidden = presets.length !== 0;
      if (!writable) {
        presetStatus.textContent = 'Редактирование пресетов недоступно: адаптер сохранения не подключён.';
      }
    }

    function validatePresetList(list) {
      if (!Array.isArray(list)) throw new Error('Хранилище должно вернуть полный массив пресетов.');
      var seen = new Set();
      return list.map(function (item) {
        if (!item || typeof item.id !== 'string' || !item.id || seen.has(item.id) ||
            typeof item.name !== 'string' || !item.name.trim() ||
            !item.view || typeof item.view !== 'object') {
          throw new Error('Хранилище вернуло некорректный список пресетов.');
        }
        seen.add(item.id);
        return {id:item.id, name:item.name, view:normalizeYoutubeTable300View(item.view)};
      });
    }

    async function writePreset(command) {
      if (destroyed || presetPending || typeof config.onChangePreset !== 'function') return;
      // Freeze the command and its view; user edits during async work cannot change it.
      var snapshot = JSON.parse(JSON.stringify(command));
      var oldIds = new Set(presets.map(function (item) { return item.id; }));
      presetPending = true;
      retryPresetCommand = null;
      presetStatus.textContent = 'Сохраняем пресет…';
      renderPresets();
      try {
        var updated = validatePresetList(await config.onChangePreset(snapshot));
        if (destroyed) return;
        presets = updated;
        if (snapshot.op === 'create') {
          var created = updated.find(function (item) { return !oldIds.has(item.id); });
          chosenPresetId = created ? created.id : '';
        } else if (snapshot.op === 'delete' && snapshot.id === chosenPresetId) {
          chosenPresetId = '';
        }
        var chosen = presets.find(function (item) { return item.id === chosenPresetId; });
        if (chosen) presetName.value = chosen.name;
        if (snapshot.op === 'delete') presetName.value = '';
        presetStatus.textContent = 'Изменение пресета сохранено.';
      } catch (error) {
        if (destroyed) return;
        retryPresetCommand = snapshot;
        presetStatus.textContent = 'Не удалось сохранить пресет: ' + safePresetError(error) + '. Повтор доступен.';
      } finally {
        presetPending = false;
        if (!destroyed) renderPresets();
      }
    }

    if (presetPanel) {
      presetSelect.addEventListener('change', function () {
        chosenPresetId = presetSelect.value;
        var chosen = presets.find(function (item) { return item.id === chosenPresetId; });
        presetName.value = chosen ? chosen.name : '';
        renderPresets();
      });
      presetName.addEventListener('input', renderPresets);
      presetApply.addEventListener('click', function () {
        if (presetPending || pending || destroyed) return;
        var chosen = presets.find(function (item) { return item.id === chosenPresetId; });
        if (!chosen) return;
        view = normalizeYoutubeTable300View(chosen.view);
        refreshFromView();
        renderViewControls();
        saveView();
        presetStatus.textContent = 'Пресет «' + chosen.name + '» применён.';
      });
      presetCreate.addEventListener('click', function () {
        var name = presetName.value.trim();
        if (name) writePreset({op:'create',name:name,view:normalizeYoutubeTable300View(view)});
      });
      presetUpdate.addEventListener('click', function () {
        if (chosenPresetId) writePreset({op:'update',id:chosenPresetId,view:normalizeYoutubeTable300View(view)});
      });
      presetRename.addEventListener('click', function () {
        var name = presetName.value.trim();
        if (chosenPresetId && name) writePreset({op:'rename',id:chosenPresetId,name:name});
      });
      presetDelete.addEventListener('click', function () {
        if (chosenPresetId) writePreset({op:'delete',id:chosenPresetId});
      });
      presetRetry.addEventListener('click', function () {
        if (retryPresetCommand) writePreset(retryPresetCommand);
      });
      renderPresets();
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
      if (allCheckbox.checked) visibleEntries.forEach(function (entry) { selectedIds.add(entry.id); });
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
      if (presetPanel) renderPresets();
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
        refreshFromView();
      } catch (error) {
        if (destroyed) return;
        showResult('Сохранение не подтверждено', '—', '—', '—',
          'Причина: ' + (error && error.message ? error.message : String(error)) +
          '. Состояние записей неизвестно; повтор доступен.');
      } finally {
        if (!destroyed) {
          pending = false;
          progress.textContent = '';
          if (presetPanel) renderPresets();
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

  mountYoutubeTable300.computeView = computeYoutubeTable300View;
  mountYoutubeTable300.computeGroups = computeYoutubeTable300Groups;
  window.mountYoutubeTable300 = mountYoutubeTable300;
}());