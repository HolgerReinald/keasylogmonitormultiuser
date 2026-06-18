/* Confirm Dialog – wiederverwendbar für alle confirm()-Ersetzungen */
(function () {
  'use strict';

  let overlay = null;
  let resolvePromise = null;

  function ensureDOM() {
    if (overlay) return;
    overlay = document.createElement('div');
    overlay.className = 'confirm-overlay';
    overlay.innerHTML = `
      <div class="confirm-box">
        <p class="confirm-message"></p>
        <div class="confirm-buttons">
          <button class="confirm-btn confirm-cancel">Abbrechen</button>
          <button class="confirm-btn confirm-ok">Bestätigen</button>
        </div>
      </div>`;
    document.body.appendChild(overlay);

    overlay.querySelector('.confirm-cancel').addEventListener('click', () => close(false));
    overlay.querySelector('.confirm-ok').addEventListener('click', () => close(true));
    overlay.addEventListener('click', (e) => { if (e.target === overlay) close(false); });
    overlay.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') close(false);
    });
  }

  function close(result) {
    overlay.classList.remove('visible');
    if (resolvePromise) { resolvePromise(result); resolvePromise = null; }
  }

  /**
   * Zeigt einen Confirm-Dialog und gibt ein Promise zurück.
   * @param {string} message - Nachricht im Dialog
   * @param {object} [opts] - Optionen
   * @param {string} [opts.okText='Bestätigen'] - Text für OK-Button
   * @param {string} [opts.cancelText='Abbrechen'] - Text für Abbrechen-Button
   * @param {boolean} [opts.danger=true] - OK-Button rot hervorheben
   * @returns {Promise<boolean>}
   */
  window.showConfirm = function (message, opts) {
    opts = opts || {};
    ensureDOM();
    overlay.querySelector('.confirm-message').textContent = message;
    const okBtn = overlay.querySelector('.confirm-ok');
    const cancelBtn = overlay.querySelector('.confirm-cancel');
    okBtn.textContent = opts.okText || 'Bestätigen';
    cancelBtn.textContent = opts.cancelText || 'Abbrechen';
    okBtn.classList.toggle('danger', opts.danger !== false);
    overlay.classList.add('visible');
    okBtn.focus();
    return new Promise((resolve) => { resolvePromise = resolve; });
  };
})();
