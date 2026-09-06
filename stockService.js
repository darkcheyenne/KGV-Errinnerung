const YahooFinance = require('yahoo-finance2').default;
const yahooFinance = new YahooFinance({ suppressNotices: ['yahooSurvey'] });

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

// Deutsche Nebenlistings liefern bei Yahoo oft kein KGV
const LOW_PRIORITY_EXCH = new Set(['GR', 'GF', 'GD', 'GS', 'GM', 'GH', 'GT']);

function toYahooSymbol(ticker, exchCode) {
  const suffix = EXCHANGE_SUFFIX[exchCode];
  return suffix ? `${ticker}.${suffix}` : ticker;
}

function isQuoteNotFoundError(err) {
  const message = err?.message || String(err);
  return /quote not found|not found for symbol/i.test(message);
}

function extractPe(result) {
  const summaryPe =
    result.summaryDetail?.trailingPE ?? result.summaryDetail?.forwardPE;
  const statsPe =
    result.defaultKeyStatistics?.trailingPE ?? result.defaultKeyStatistics?.forwardPE;

  if (summaryPe != null) return Number(summaryPe);
  if (statsPe != null) return Number(statsPe);

  const price = result.price?.regularMarketPrice;
  const eps = result.defaultKeyStatistics?.trailingEps;
  if (price != null && eps != null && eps > 0) {
    return Number(price) / Number(eps);
  }

  return null;
}

function getSymbolPriority(exchCode, ticker, index) {
  let priority = index;

  if (exchCode === 'US' || exchCode === 'UA') priority -= 100;
  if (['CN', 'NO', 'FH', 'HE', 'LN'].includes(exchCode)) priority -= 50;
  if (LOW_PRIORITY_EXCH.has(exchCode)) priority += 1000;
  if (['PQ', 'OT', 'OB', 'PK'].includes(exchCode)) priority += 500;
  if (ticker && ticker.length === 5 && ticker.endsWith('F')) priority += 300;

  return priority;
}

function buildSymbolPriority(mappings) {
  const priority = new Map();

  sortMappings(mappings).forEach((mapping, index) => {
    const next = getSymbolPriority(mapping.exchCode, mapping.ticker, index);
    const current = priority.get(mapping.symbol);
    if (current == null || next < current) {
      priority.set(mapping.symbol, next);
    }
  });

  return priority;
}

function sortMappings(mappings) {
  return [...mappings].sort((a, b) => {
    return getSymbolPriority(a.exchCode, a.ticker, 0) - getSymbolPriority(b.exchCode, b.ticker, 0);
  });
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

async function findBestSymbol(candidates) {
  let fallback = null;

  for (const symbol of uniqueSymbols(candidates)) {
    try {
      const quote = await getPeRatio(symbol);
      if (quote.pe != null) {
        return { symbol, ...quote };
      }
      if (!fallback) {
        fallback = { symbol, ...quote };
      }
    } catch (err) {
      if (!isQuoteNotFoundError(err)) {
        throw err;
      }
    }
  }

  return fallback;
}

async function getPeRatio(symbol) {
  const result = await yahooFinance.quoteSummary(symbol, {
    modules: ['summaryDetail', 'price', 'defaultKeyStatistics'],
  });

  const pe = extractPe(result);
  const name = result.price?.longName || result.price?.shortName || null;

  return {
    pe,
    name,
  };
}

async function resolveStock(isin) {
  const mappings = sortMappings(await isinToMappings(isin));
  const primary = mappings[0];

  const candidates = uniqueSymbols([
    ...mappings.map((m) => m.symbol),
    ...await searchYahooSymbols(isin),
    ...await searchYahooSymbols(primary.name || primary.ticker),
  ]);

  const resolved = await findBestSymbol(candidates);
  if (!resolved) {
    throw new Error(
      `Kein Yahoo-Symbol für diese ISIN gefunden (versucht: ${candidates.join(', ')})`
    );
  }

  return {
    symbol: resolved.symbol,
    name: resolved.name || primary.name,
    pe: resolved.pe,
  };
}

module.exports = { resolveStock, getPeRatio, findBestSymbol, isinToMappings };
