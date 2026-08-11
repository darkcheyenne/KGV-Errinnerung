const yahooModule = require('yahoo-finance2').default;

// v2: fertige API-Instanz; v3: YahooFinance-Klasse
const yahooFinance =
  typeof yahooModule?.quoteSummary === 'function'
    ? yahooModule
    : new yahooModule();

const EXCHANGE_SUFFIX = {
  GR: 'DE',
  GF: 'F',
  GS: 'SG',
  GM: 'MU',
  GD: 'DU',
  GH: 'HM',
  GT: 'HA',
};

function toYahooSymbol(ticker, exchCode) {
  const suffix = EXCHANGE_SUFFIX[exchCode];
  return suffix ? `${ticker}.${suffix}` : ticker;
}

async function isinToSymbol(isin) {
  const response = await fetch('https://api.openfigi.com/v3/mapping', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify([{ idType: 'ID_ISIN', idValue: isin.toUpperCase() }]),
  });

  if (!response.ok) {
    throw new Error('ISIN konnte nicht aufgelöst werden');
  }

  const data = await response.json();
  const entry = data[0]?.data?.[0];
  if (!entry?.ticker) {
    throw new Error('Kein Börsensymbol für diese ISIN gefunden');
  }

  return {
    symbol: toYahooSymbol(entry.ticker, entry.exchCode),
    name: entry.name || null,
  };
}

async function getPeRatio(symbol) {
  const result = await yahooFinance.quoteSummary(symbol, {
    modules: ['summaryDetail', 'price'],
  });

  const pe = result.summaryDetail?.trailingPE ?? result.summaryDetail?.forwardPE;
  const name = result.price?.longName || result.price?.shortName || null;

  return {
    pe: pe != null ? Number(pe) : null,
    name,
  };
}

async function resolveStock(isin) {
  const mapped = await isinToSymbol(isin);
  const quote = await getPeRatio(mapped.symbol);

  return {
    symbol: mapped.symbol,
    name: quote.name || mapped.name,
    pe: quote.pe,
  };
}

module.exports = { resolveStock, getPeRatio };
