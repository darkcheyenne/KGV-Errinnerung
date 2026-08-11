const stockBody = document.getElementById('stock-body');
const stockTable = document.getElementById('stock-table');
const loading = document.getElementById('loading');
const empty = document.getElementById('empty');
const errorBanner = document.getElementById('error');
const addDialog = document.getElementById('add-dialog');
const addForm = document.getElementById('add-form');
const formError = document.getElementById('form-error');
const submitBtn = document.getElementById('submit-btn');

function openDialog() {
  formError.hidden = true;
  addForm.reset();
  addDialog.showModal();
}

document.getElementById('add-btn').addEventListener('click', openDialog);
document.getElementById('add-btn-empty').addEventListener('click', openDialog);
document.getElementById('cancel-btn').addEventListener('click', () => addDialog.close());

function formatPe(pe) {
  if (pe == null) return '—';
  return Number(pe).toLocaleString('de-DE', { maximumFractionDigits: 2 });
}

function renderStocks(stocks) {
  loading.hidden = true;

  if (stocks.length === 0) {
    empty.hidden = false;
    stockTable.hidden = true;
    return;
  }

  empty.hidden = true;
  stockTable.hidden = false;

  stockBody.innerHTML = stocks
    .map((stock) => {
      const rowClass = stock.belowThreshold ? 'below-threshold' : '';
      const peClass = stock.pe != null ? 'pe-value' : 'pe-missing';
      const peText = stock.error ? stock.error : formatPe(stock.pe);
      const name = stock.name || '—';

      return `
        <tr class="${rowClass}">
          <td>${escapeHtml(name)}</td>
          <td>${escapeHtml(stock.isin)}</td>
          <td>${escapeHtml(stock.symbol || '—')}</td>
          <td class="${peClass}">${escapeHtml(peText)}</td>
          <td>${formatPe(stock.threshold)}</td>
          <td>
            <button type="button" class="btn btn-danger" data-delete="${stock.id}">Löschen</button>
          </td>
        </tr>
      `;
    })
    .join('');

  stockBody.querySelectorAll('[data-delete]').forEach((btn) => {
    btn.addEventListener('click', () => deleteStock(btn.dataset.delete));
  });
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

async function loadStocks() {
  loading.hidden = false;
  errorBanner.hidden = true;

  try {
    const response = await fetch('/api/stocks');
    if (!response.ok) throw new Error('Liste konnte nicht geladen werden.');
    const stocks = await response.json();
    renderStocks(stocks);
  } catch (err) {
    loading.hidden = true;
    errorBanner.textContent = err.message;
    errorBanner.hidden = false;
  }
}

async function deleteStock(id) {
  try {
    const response = await fetch(`/api/stocks/${id}`, { method: 'DELETE' });
    if (!response.ok) throw new Error('Eintrag konnte nicht gelöscht werden.');
    await loadStocks();
  } catch (err) {
    errorBanner.textContent = err.message;
    errorBanner.hidden = false;
  }
}

addForm.addEventListener('submit', async (event) => {
  event.preventDefault();

  formError.hidden = true;
  submitBtn.disabled = true;
  submitBtn.textContent = 'Wird hinzugefügt…';

  const isin = document.getElementById('isin').value.trim();
  const threshold = document.getElementById('threshold').value;

  try {
    const response = await fetch('/api/stocks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ isin, threshold }),
    });

    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.error || 'Hinzufügen fehlgeschlagen.');
    }

    addDialog.close();
    await loadStocks();
  } catch (err) {
    formError.textContent = err.message;
    formError.hidden = false;
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = 'Hinzufügen';
  }
});

loadStocks();
