/**
 * Keasy Log Monitor — Threshold Rules Panel
 * Schwellwert-Regeln: Render, CRUD, Validation.
 */
(function() {
window.Keasy = window.Keasy || {};

const { state } = Keasy;

function buildRuleSummaryText(rule) {
  const name = rule.name || rule.contains || 'Neue Regel';
  const opSymbols = { '>': '>', '<': '<', '>=': '≥', '<=': '≤', '=': '=' };
  const op = opSymbols[rule.operator] || '>';
  const val = rule.value != null ? rule.value : '?';
  const before = rule.before ? ` ${rule.before}` : '';
  const condParts = [];
  if (rule.contains) condParts.push(`„${rule.contains}"${before}`);
  condParts.push(`${op} ${val}`);
  return { name, condition: condParts.join(' ') };
}

function toggleThresholdRule(card) {
  const wasExpanded = card.classList.contains('is-expanded');
  card.parentElement.querySelectorAll('.threshold-rule-card.is-expanded').forEach(c => c.classList.remove('is-expanded'));
  if (!wasExpanded) card.classList.add('is-expanded');
}

function renderThresholdRules(expandIndex) {
  const container = document.getElementById('cfg-threshold-list');
  if (!container) return;
  container.innerHTML = '';
  state.configThresholdRules.forEach((rule, i) => {
    const card = document.createElement('div');
    card.className = 'threshold-rule-card';

    const isEmpty = !rule.name && !rule.contains && rule.value == null;
    if (expandIndex === i || isEmpty) card.classList.add('is-expanded');

    const summary = buildRuleSummaryText(rule);

    const summaryDiv = document.createElement('div');
    summaryDiv.className = 'threshold-rule-summary';
    summaryDiv.innerHTML = `
      <span class="rule-chevron">▶</span>
      <span class="rule-label"><span class="rule-name"></span><span class="rule-condition"></span></span>
      <span class="rule-actions">
        <button class="rule-edit-btn" title="Bearbeiten" data-admin-only>✏️</button>
        <button class="rule-delete-btn" title="Regel entfernen" data-admin-only>✕</button>
      </span>`;
    summaryDiv.querySelector('.rule-name').textContent = summary.name;
    summaryDiv.querySelector('.rule-condition').textContent = ' — ' + summary.condition;
    summaryDiv.querySelector('.rule-edit-btn').addEventListener('click', (e) => { e.stopPropagation(); toggleThresholdRule(card); });
    summaryDiv.querySelector('.rule-delete-btn').addEventListener('click', (e) => { e.stopPropagation(); removeThresholdRule(i); });
    summaryDiv.addEventListener('click', () => toggleThresholdRule(card));
    card.appendChild(summaryDiv);

    const editDiv = document.createElement('div');
    editDiv.className = 'threshold-rule-edit';
    editDiv.innerHTML = `
      <div class="threshold-rule-header">
        <input type="text" data-field="name" placeholder="Regelname (z.B. WorkingSet über 4 GB)">
      </div>
      <div class="threshold-rule-body">
        <label>Zeile enthält:</label>
        <input type="text" data-field="contains" placeholder="z.B. WorkingSet:">
        <label>Einheit (optional):</label>
        <input type="text" data-field="before" placeholder="z.B. MB — Text nach der Zahl">
        <label>Alarm wenn:</label>
        <div style="display:flex;gap:6px">
          <select data-field="operator">
            <option value=">">größer als (&gt;)</option>
            <option value="<">kleiner als (&lt;)</option>
            <option value=">=">größer/gleich (≥)</option>
            <option value="<=">kleiner/gleich (≤)</option>
            <option value="=">gleich (=)</option>
          </select>
          <input type="number" data-field="value" placeholder="z.B. 4000" style="width:100px">
        </div>
      </div>`;
    editDiv.querySelector('[data-field="name"]').value = rule.name || '';
    editDiv.querySelector('[data-field="contains"]').value = rule.contains || '';
    editDiv.querySelector('[data-field="before"]').value = rule.before || '';
    editDiv.querySelector('[data-field="operator"]').value = rule.operator || '>';
    editDiv.querySelector('[data-field="value"]').value = rule.value != null ? rule.value : '';
    editDiv.querySelectorAll('input, select').forEach(el => {
      el.addEventListener('input', () => {
        Keasy.config.markConfigDirty();
        const r = {
          name: editDiv.querySelector('[data-field="name"]').value.trim(),
          contains: editDiv.querySelector('[data-field="contains"]').value.trim(),
          before: editDiv.querySelector('[data-field="before"]').value.trim(),
          operator: editDiv.querySelector('[data-field="operator"]').value,
          value: parseFloat(editDiv.querySelector('[data-field="value"]').value) || null
        };
        const s = buildRuleSummaryText(r);
        summaryDiv.querySelector('.rule-name').textContent = s.name;
        summaryDiv.querySelector('.rule-condition').textContent = ' — ' + s.condition;
      });
    });
    card.appendChild(editDiv);
    container.appendChild(card);
  });
  // Re-apply admin-only restrictions
  if (window.Keasy && window.Keasy.auth && window.Keasy.auth.applyUserRole) {
    window.Keasy.auth.applyUserRole();
  }
}

function addThresholdRule() {
  syncThresholdRulesFromDOM();
  state.configThresholdRules.push({ name: '', contains: '', before: '', operator: '>', value: null });
  renderThresholdRules(state.configThresholdRules.length - 1);
  Keasy.config.markConfigDirty();
}

function removeThresholdRule(index) {
  syncThresholdRulesFromDOM();
  state.configThresholdRules.splice(index, 1);
  renderThresholdRules();
  Keasy.config.markConfigDirty();
}

function syncThresholdRulesFromDOM() {
  const cards = document.querySelectorAll('#cfg-threshold-list .threshold-rule-card');
  if (cards.length === state.configThresholdRules.length) {
    cards.forEach((card, i) => {
      const edit = card.querySelector('.threshold-rule-edit');
      state.configThresholdRules[i] = {
        name: edit.querySelector('[data-field="name"]').value.trim(),
        contains: edit.querySelector('[data-field="contains"]').value.trim(),
        before: edit.querySelector('[data-field="before"]').value.trim(),
        operator: edit.querySelector('[data-field="operator"]').value,
        value: parseFloat(edit.querySelector('[data-field="value"]').value) || null
      };
    });
  }
}

function getThresholdRulesFromForm() {
  const cards = document.querySelectorAll('#cfg-threshold-list .threshold-rule-card');
  const rules = [];
  let hasError = false;
  cards.forEach((card) => {
    const edit = card.querySelector('.threshold-rule-edit');
    const name = edit.querySelector('[data-field="name"]').value.trim();
    const contains = edit.querySelector('[data-field="contains"]').value.trim();
    const before = edit.querySelector('[data-field="before"]').value.trim();
    const operator = edit.querySelector('[data-field="operator"]').value;
    const rawValue = edit.querySelector('[data-field="value"]').value.trim();
    const value = parseFloat(rawValue);

    const missingContains = !contains;
    const missingValue = !rawValue || isNaN(value);
    edit.querySelector('[data-field="contains"]').style.borderColor = missingContains ? '#ef4444' : '';
    edit.querySelector('[data-field="value"]').style.borderColor = missingValue ? '#ef4444' : '';
    if (missingContains || missingValue) { hasError = true; card.classList.add('is-expanded'); return; }

    rules.push({ name: name || contains, contains, before: before || undefined, operator, value });
  });
  if (hasError) return null;
  return rules;
}

Keasy.threshold = {
  renderThresholdRules, addThresholdRule, removeThresholdRule, getThresholdRulesFromForm
};
Object.assign(window, { addThresholdRule, removeThresholdRule });

})();
