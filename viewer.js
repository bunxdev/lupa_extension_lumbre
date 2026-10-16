// Lumbre viewer — wires the dropzone, file picker, render, raw toggle and clipboard.

(function () {
  'use strict';

  const dropzone = document.getElementById('dropzone');
  const fileInput = document.getElementById('file-input');
  const reader = document.getElementById('reader');
  const rawEl = document.getElementById('raw');
  const meta = document.getElementById('meta');
  const status = document.getElementById('status');
  const openBtn = document.getElementById('open-btn');
  const toggleRawBtn = document.getElementById('toggle-raw-btn');
  const copyBtn = document.getElementById('copy-btn');
  const closeBtn = document.getElementById('close-btn');

  let lastSource = '';
  let lastFilename = '';
  let lastHtml = '';
  let viewMode = 'rendered'; // 'rendered' | 'raw'

  let statusTimer = null;
  function flash(message, kind) {
    status.textContent = message || '';
    status.className = 'status' + (kind ? ' ' + kind : '') + ' show';
    if (statusTimer) clearTimeout(statusTimer);
    statusTimer = setTimeout(() => { status.classList.remove('show'); }, 2400);
  }

  function formatBytes(n) {
    if (n < 1024) return n + ' B';
    if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' KB';
    return (n / 1024 / 1024).toFixed(2) + ' MB';
  }

  function formatTimestamp(date) {
    const pad = (n) => String(n).padStart(2, '0');
    return pad(date.getDate()) + '-' + pad(date.getMonth() + 1) + '-' + date.getFullYear() +
      ' ' + pad(date.getHours()) + ':' + pad(date.getMinutes());
  }

  function showReader() {
    dropzone.hidden = true;
    reader.hidden = false;
    rawEl.hidden = true;
    toggleRawBtn.hidden = false;
    toggleRawBtn.textContent = 'Ver crudo';
    copyBtn.hidden = false;
    closeBtn.hidden = false;
    viewMode = 'rendered';
  }
  function showRaw() {
    dropzone.hidden = true;
    reader.hidden = true;
    rawEl.hidden = false;
    toggleRawBtn.hidden = false;
    toggleRawBtn.textContent = 'Ver renderizado';
    copyBtn.hidden = false;
    closeBtn.hidden = false;
    viewMode = 'raw';
  }
  function showDropzone() {
    dropzone.hidden = false;
    reader.hidden = true;
    rawEl.hidden = true;
    toggleRawBtn.hidden = true;
    copyBtn.hidden = true;
    closeBtn.hidden = true;
    meta.textContent = '';
    lastSource = '';
    lastFilename = '';
    lastHtml = '';
    viewMode = 'rendered';
  }

  function renderText(text, fileName, fileSize, modified) {
    lastSource = text;
    lastFilename = fileName || '';
    const { html } = window.LumbreMd.parse(text);
    lastHtml = html;
    reader.innerHTML = html;
    rawEl.textContent = text;

    // Make sure all anchor clicks open in a new tab even if the html had implicit targets.
    for (const a of reader.querySelectorAll('a[href]')) {
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
    }

    const parts = [];
    if (fileName) parts.push(fileName);
    if (typeof fileSize === 'number') parts.push(formatBytes(fileSize));
    if (modified instanceof Date) parts.push(formatTimestamp(modified));
    meta.textContent = parts.join(' · ');

    document.title = (fileName ? fileName + ' — ' : '') + 'Lumbre';
    showReader();
  }

  function readFileAsText(file) {
    return new Promise((res, rej) => {
      const r = new FileReader();
      r.onload = () => res(r.result);
      r.onerror = () => rej(new Error('No se pudo leer el archivo.'));
      r.readAsText(file);
    });
  }

  async function handleFile(file) {
    if (!file) return;
    // 16 MiB cap — large enough for any reasonable .md, small enough not to crush
    // the renderer when someone drops a binary by accident.
    if (file.size > 16 * 1024 * 1024) {
      flash('Archivo demasiado grande (>16 MB).', 'err');
      return;
    }
    try {
      const text = await readFileAsText(file);
      const modified = file.lastModified ? new Date(file.lastModified) : null;
      renderText(text, file.name, file.size, modified);
      flash('Cargado: ' + file.name, 'ok');
    } catch (e) {
      flash('Error: ' + e.message, 'err');
    }
  }

  // Public API for tests run via lupa /extension/run.
  window.__lumbre = {
    parse: (t) => window.LumbreMd.parse(t),
    renderText: renderText,
    showDropzone: showDropzone,
    state: () => ({ viewMode: viewMode, hasFile: !!lastSource, filename: lastFilename }),
  };

  // ----- wire up -----

  openBtn.addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', (ev) => {
    const f = ev.target.files && ev.target.files[0];
    if (f) handleFile(f);
    fileInput.value = '';
  });

  // Click-on-dropzone also triggers picker, but only when no file is loaded yet.
  dropzone.addEventListener('click', () => fileInput.click());
  dropzone.addEventListener('keydown', (ev) => {
    if (ev.key === 'Enter' || ev.key === ' ') {
      ev.preventDefault();
      fileInput.click();
    }
  });

  function preventDefaults(e) { e.preventDefault(); e.stopPropagation(); }
  ['dragenter', 'dragover', 'dragleave', 'drop'].forEach((ev) => {
    document.body.addEventListener(ev, preventDefaults, false);
  });
  ['dragenter', 'dragover'].forEach((ev) => {
    dropzone.addEventListener(ev, () => dropzone.classList.add('is-hover'));
  });
  ['dragleave', 'drop'].forEach((ev) => {
    dropzone.addEventListener(ev, () => dropzone.classList.remove('is-hover'));
  });
  document.body.addEventListener('drop', (ev) => {
    const f = ev.dataTransfer && ev.dataTransfer.files && ev.dataTransfer.files[0];
    if (f) handleFile(f);
  });

  toggleRawBtn.addEventListener('click', () => {
    if (viewMode === 'rendered') showRaw();
    else showReader();
  });

  copyBtn.addEventListener('click', async () => {
    try {
      const payload = viewMode === 'raw' ? lastSource : lastHtml;
      await navigator.clipboard.writeText(payload);
      flash('Copiado al portapapeles.', 'ok');
    } catch (e) {
      flash('No se pudo copiar: ' + e.message, 'err');
    }
  });

  closeBtn.addEventListener('click', () => {
    showDropzone();
    document.title = 'Lumbre';
  });

  // Keyboard: Esc closes, R toggles raw.
  document.addEventListener('keydown', (ev) => {
    if (ev.key === 'Escape' && lastSource) {
      showDropzone();
      document.title = 'Lumbre';
    }
    if (ev.key.toLowerCase() === 'r' && !ev.ctrlKey && !ev.metaKey && lastSource && document.activeElement.tagName !== 'INPUT') {
      toggleRawBtn.click();
    }
  });
})();
