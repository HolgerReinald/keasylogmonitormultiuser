/**
 * Keasy Log Monitor — Priority Rules Panel
 * Prioritätsregeln (Dringlichkeit): Render, CRUD, Validation.
 * Aufbau bewusst identisch zu thresholdPanel.js (Accordion-Karten).
 */
(function() {
window.Keasy = window.Keasy || {};

const { state } = Keasy;

const LEVEL_OPTIONS = [
  { value: 'kritisch', text: '🔴 Kritisch — sofort handeln' },
  { value: 'normal', text: 'Normal — normale Arbeitsliste' },
  { value: 'gering', text: 'Gering — bekannt/geduldet' }
];

function buildRuleSummaryText(rule) {
  const name = rule.name || rule.contains || 'Neue Regel';
  const meta = Keasy.utils.severityMeta(rule.level);
  const condition = rule.contains
    ? `„${rule.contains}" → ${meta.icon} ${meta.label}`
    : `→ ${meta.icon} ${meta.label}`;
  return { name, condition };
}

function togglePriorityRule(card) {
  const wasExpanded = card.classList.contains('is-expanded');
  card.parentElement.querySelectorAll('.threshold-rule-card.is-expanded').forEach(c => c.classList.remove('is-expanded'));
  if (!wasExpanded) card.classList.add('is-expanded');
}

function renderPriorityRules(expandIndex) {
  const container = document.getElementById('cfg-priority-list');
  if (!container) return;
  container.innerHTML = '';
  state.configPriorityRules.forEach((rule, i) => {
    const card = document.createElement('div');
    card.className = 'threshold-rule-card';

    const isEmpty = !rule.name && !rule.contains;
    if (expandIndex === i || isEmpty) card.classList.add('is-expanded');

    const summary = buildRuleSummaryText(rule);

    const summaryDiv = document.createElement('div');
    summaryDiv.className = 'threshold-rule-summary';
    summaryDiv.innerHTML = `
      <span class="rule-chevron">▶</span>
      <span class="rule-label"><span class="rule-name"></span><span class="rule-condition"></span></span>
      <span class="rule-actions">
        <button class="rule-edit-btn rule-move-btn" title="Vorrang erhöhen (nach oben)" data-admin-only ${i === 0 ? 'disabled' : ''}>▲</button>
        <button class="rule-edit-btn rule-move-btn" title="Vorrang senken (nach unten)" data-admin-only ${i === state.configPriorityRules.length - 1 ? 'disabled' : ''}>▼</button>
        <button class="rule-edit-btn" title="Bearbeiten" data-admin-only>✏️</button>
        <button class="rule-delete-btn" title="Regel entfernen" data-admin-only>✕</button>
      </span>`;
    summaryDiv.querySelector('.rule-name').textContent = summary.name;
    summaryDiv.querySelector('.rule-condition').textContent = ' — ' + summary.condition;
    const moveBtns = summaryDiv.querySelectorAll('.rule-move-btn');
    moveBtns[0].addEventListener('click', (e) => { e.stopPropagation(); movePriorityRule(i, -1); });
    moveBtns[1].addEventListener('click', (e) => { e.stopPropagation(); movePriorityRule(i, 1); });
    summaryDiv.querySelector('.rule-edit-btn:not(.rule-move-btn)').addEventListener('click', (e) => { e.stopPropagation(); togglePriorityRule(card); });
    summaryDiv.querySelector('.rule-delete-btn').addEventListener('click', (e) => { e.stopPropagation(); removePriorityRule(i); });
    summaryDiv.addEventListener('click', () => togglePriorityRule(card));
    card.appendChild(summaryDiv);

    const editDiv = document.createElement('div');
    editDiv.className = 'threshold-rule-edit';
    editDiv.innerHTML = `
      <div class="threshold-rule-header">
        <input type="text" data-field="name" placeholder="Regelname (z.B. SMTP-Versand)">
      </div>
      <div class="threshold-rule-body">
        <label>Zeile enthält:</label>
        <input type="text" data-field="contains" placeholder="z.B. Send_over_SMTP">
        <label>Dringlichkeit:</label>
        <select data-field="level">
          ${LEVEL_OPTIONS.map(o => `<option value="${o.value}">${o.text}</option>`).join('')}
        </select>
      </div>`;
    editDiv.querySelector('[data-field="name"]').value = rule.name || '';
    editDiv.querySelector('[data-field="contains"]').value = rule.contains || '';
    editDiv.querySelector('[data-field="level"]').value = rule.level || 'normal';
    editDiv.querySelectorAll('input, select').forEach(el => {
      el.addEventListener('input', () => {
        Keasy.config.markConfigDirty();
        const r = {
          name: editDiv.querySelector('[data-field="name"]').value.trim(),
          contains: editDiv.querySelector('[data-field="contains"]').value.trim(),
          level: editDiv.querySelector('[data-field="level"]').value
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

function addPriorityRule() {
  syncPriorityRulesFromDOM();
  state.configPriorityRules.push({ name: '', contains: '', level: 'kritisch' });
  renderPriorityRules(state.configPriorityRules.length - 1);
  Keasy.config.markConfigDirty();
}

function removePriorityRule(index) {
  syncPriorityRulesFromDOM();
  state.configPriorityRules.splice(index, 1);
  renderPriorityRules();
  Keasy.config.markConfigDirty();
}

// Regel nach oben schieben — die Reihenfolge entscheidet über den Vorrang
// (erste Treffer-Regel gewinnt), deshalb muss sie umsortierbar sein.
function movePriorityRule(index, delta) {
  syncPriorityRulesFromDOM();
  const target = index + delta;
  if (target < 0 || target >= state.configPriorityRules.length) return;
  const rules = state.configPriorityRules;
  [rules[index], rules[target]] = [rules[target], rules[index]];
  renderPriorityRules();
  Keasy.config.markConfigDirty();
}

function syncPriorityRulesFromDOM() {
  const cards = document.querySelectorAll('#cfg-priority-list .threshold-rule-card');
  if (cards.length === state.configPriorityRules.length) {
    cards.forEach((card, i) => {
      const edit = card.querySelector('.threshold-rule-edit');
      state.configPriorityRules[i] = {
        name: edit.querySelector('[data-field="name"]').value.trim(),
        contains: edit.querySelector('[data-field="contains"]').value.trim(),
        level: edit.querySelector('[data-field="level"]').value
      };
    });
  }
}

function getPriorityRulesFromForm() {
  const cards = document.querySelectorAll('#cfg-priority-list .threshold-rule-card');
  const rules = [];
  let hasError = false;
  cards.forEach((card) => {
    const edit = card.querySelector('.threshold-rule-edit');
    const name = edit.querySelector('[data-field="name"]').value.trim();
    const contains = edit.querySelector('[data-field="contains"]').value.trim();
    const level = edit.querySelector('[data-field="level"]').value;

    const missingContains = !contains;
    edit.querySelector('[data-field="contains"]').style.borderColor = missingContains ? '#ef4444' : '';
    if (missingContains) { hasError = true; card.classList.add('is-expanded'); return; }

    rules.push({ name: name || contains, contains, level });
  });
  if (hasError) return null;
  return rules;
}

Keasy.priority = {
  renderPriorityRules, addPriorityRule, removePriorityRule, movePriorityRule, getPriorityRulesFromForm
};
Object.assign(window, { addPriorityRule, removePriorityRule, movePriorityRule });

})();
