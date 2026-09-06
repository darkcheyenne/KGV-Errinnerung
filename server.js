const express = require('express');
const path = require('path');
const db = require('./db');
const { resolveStock, getPeRatio } = require('./stockService');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

function enrichStock(row) {
  return {
    id: row.id,
    isin: row.isin,
    name: row.name,
    symbol: row.symbol,
    threshold: row.threshold,
    createdAt: row.created_at,
    pe: null,
    belowThreshold: false,
    error: null,
  };
}

async function fetchPeForRow(row) {
  const stock = enrichStock(row);

  if (!row.symbol) {
    stock.error = 'Kein Symbol gespeichert';
    return stock;
  }

  try {
    const quote = await getPeRatio(row.symbol);
    if (quote.name && !row.name) {
      db.prepare('UPDATE stocks SET name = ? WHERE id = ?').run(quote.name, row.id);
      stock.name = quote.name;
    }
    stock.pe = quote.pe;
    if (stock.pe != null) {
      stock.belowThreshold = stock.pe < row.threshold;
    } else {
      try {
        const resolved = await resolveStock(row.isin);
        if (resolved.symbol !== row.symbol || resolved.pe != null) {
          db.prepare('UPDATE stocks SET symbol = ?, name = ? WHERE id = ?')
            .run(resolved.symbol, resolved.name || row.name, row.id);
          stock.symbol = resolved.symbol;
          stock.name = resolved.name || row.name;
          stock.pe = resolved.pe;
          if (stock.pe != null) {
            stock.belowThreshold = stock.pe < row.threshold;
          }
        }
      } catch {
        // Kein alternatives Symbol mit KGV gefunden
      }
    }
  } catch (err) {
    const message = err.message || '';
    if (/quote not found|not found for symbol/i.test(message)) {
      try {
        const resolved = await resolveStock(row.isin);
        db.prepare('UPDATE stocks SET symbol = ?, name = ? WHERE id = ?')
          .run(resolved.symbol, resolved.name || row.name, row.id);
        stock.symbol = resolved.symbol;
        stock.name = resolved.name || row.name;
        stock.pe = resolved.pe;
        if (stock.pe != null) {
          stock.belowThreshold = stock.pe < row.threshold;
        }
        return stock;
      } catch (resolveErr) {
        stock.error = resolveErr.message || 'KGV konnte nicht geladen werden';
        return stock;
      }
    }
    stock.error = message || 'KGV konnte nicht geladen werden';
  }

  return stock;
}

app.get('/api/stocks', async (req, res) => {
  try {
    const rows = db.prepare('SELECT * FROM stocks ORDER BY created_at DESC').all();
    const stocks = await Promise.all(rows.map(fetchPeForRow));
    res.json(stocks);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/stocks', async (req, res) => {
  const { isin, threshold } = req.body;

  if (!isin || typeof isin !== 'string' || !/^[A-Z]{2}[A-Z0-9]{9}[0-9]$/i.test(isin.trim())) {
    return res.status(400).json({ error: 'Bitte eine gültige ISIN eingeben (12 Zeichen).' });
  }

  const parsedThreshold = Number(threshold);
  if (!Number.isFinite(parsedThreshold) || parsedThreshold <= 0) {
    return res.status(400).json({ error: 'Bitte einen gültigen KGV-Schwellenwert größer 0 eingeben.' });
  }

  const normalizedIsin = isin.trim().toUpperCase();

  const existing = db.prepare('SELECT id FROM stocks WHERE isin = ?').get(normalizedIsin);
  if (existing) {
    return res.status(409).json({ error: 'Diese ISIN ist bereits in der Liste.' });
  }

  try {
    const resolved = await resolveStock(normalizedIsin);
    const result = db
      .prepare('INSERT INTO stocks (isin, name, symbol, threshold) VALUES (?, ?, ?, ?)')
      .run(normalizedIsin, resolved.name, resolved.symbol, parsedThreshold);

    const row = db.prepare('SELECT * FROM stocks WHERE id = ?').get(result.lastInsertRowid);
    const stock = await fetchPeForRow(row);
    res.status(201).json(stock);
  } catch (err) {
    res.status(400).json({ error: err.message || 'Aktie konnte nicht hinzugefügt werden.' });
  }
});

app.delete('/api/stocks/:id', (req, res) => {
  const id = Number(req.params.id);
  const result = db.prepare('DELETE FROM stocks WHERE id = ?').run(id);
  if (result.changes === 0) {
    return res.status(404).json({ error: 'Eintrag nicht gefunden.' });
  }
  res.json({ ok: true });
});

app.listen(PORT, () => {
  console.log(`KGV-Errinnerung läuft auf http://localhost:${PORT}`);
});
