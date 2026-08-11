const YahooFinance = require('yahoo-finance2').default;
const yahooFinance = new YahooFinance();

// OpenFIGI exchCode → Yahoo Finance Börsensuffix
const EXCHANGE_SUFFIX = {
  GR: 'DE',
  GF: 'F',
  GS: 'SG',
  GM: 'MU',
  GD: 'DU',
  GH: 'HM',
  GT: 'HA',
  FH: 'HE',
  HE: 'HE',
  SS: 'ST',
  NO: 'OL',
  LN: 'L',
  FP: 'PA',
  NA: 'AS',
  SW: 'SW',
  HK: 'HK',
  JT: 'T',
  KS: 'KS',
  TT: 'T',
  SP: 'SA',
  IM: 'MI',
  MC: 'MC',
  ID: 'IR',
  PW: 'WA',
  CN: 'TO',
  CV: 'V',
};

function toYahooSymbol(ticker, exchCode) {
  const suffix = EXCHANGE_SUFFIX[exchCode];
  return suffix ? `${ticker}.${suffix}` : ticker;
}

function isQuoteNotFoundError(err) {
  const message = err?.message || String(err);
  return /quote not found|not found for symbol/i.test(message);
}

async function isinToMappings(isin) {
  const response = await fetch('https://api.openfigi.com/v3/mapping', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify([{ idType: 'ID_ISIN', idValue: isin.toUpperCase() }]),
  });

  if (!response.ok) {
    throw new Error('ISIN konnte nicht aufgelöst werden');
  }

  const data = await response.json();
  const entries = data[0]?.data || [];
  if (entries.length === 0) {
    throw new Error('Kein Börsensymbol für diese ISIN gefunden');
  }

  return entries.map((entry) => ({
    symbol: toYahooSymbol(entry.ticker, entry.exchCode),
    name: entry.name || null,
    ticker: entry.ticker,
    exchCode: entry.exchCode,
  }));
}

async function searchYahooSymbols(query) {
  try {
    const result = await yahooFinance.search(query, { quotesCount: 8 });
    return (result.quotes || [])
      .filter((q) => q.symbol && (q.quoteType === 'EQUITY' || q.quoteType === 'ETF'))
      .map((q) => q.symbol);
  } catch {
    return [];
  }
}

async function findWorkingSymbol(candidates) {
  const seen = new Set();

  for (const symbol of candidates) {
    if (!symbol || seen.has(symbol)) continue;
    seen.add(symbol);

    try {
      await yahooFinance.quoteSummary(symbol, { modules: ['price'] });
      return symbol;
    } catch (err) {
      if (!isQuoteNotFoundError(err)) {
        throw err;
      }
    }
  }

  return null;
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
  const mappings = await isinToMappings(isin);
  const primary = mappings[0];

  const candidates = [
    ...mappings.map((m) => m.symbol),
    ...await searchYahooSymbols(isin),
    ...await searchYahooSymbols(primary.name || primary.ticker),
  ];

  const symbol = await findWorkingSymbol(candidates);
  if (!symbol) {
    throw new Error(
      `Kein Yahoo-Symbol für diese ISIN gefunden (versucht: ${[...new Set(candidates)].join(', ')})`
    );
  }

  const quote = await getPeRatio(symbol);

  return {
    symbol,
    name: quote.name || primary.name,
    pe: quote.pe,
  };
}

module.exports = { resolveStock, getPeRatio, findWorkingSymbol, isinToMappings };
