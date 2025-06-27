const axios = require('axios');

const tokens = {
  ETH: { blockchain: 'Ethereum', address: '0x0000000000000000000000000000000000000000' },
  WETH: { blockchain: 'Ethereum', address: '0xC02aaA39b223FE8D0a0e5C4F27eAD9083C756Cc2' },
  DAI: { blockchain: 'Ethereum', address: '0x6B175474E89094C44Da98b954EedeAC495271d0F' },
  USDC: { blockchain: 'Ethereum', address: '0xA0b86991c6218b36c1d19d4a2e9eb0ce3606eb48' },
  BTC: { blockchain: 'Bitcoin', address: '0x0000000000000000000000000000000000000000' }
};

async function fetchTokenPrice(symbol) {
  const { blockchain, address } = tokens[symbol];
  const url = `https://api.diadata.org/v1/assetQuotation/${blockchain}/${address}`;
  try {
    const res = await axios.get(url);
    return { symbol, price: res.data.Price };
  } catch (e) {
    console.error(`Error fetching price for ${symbol}:`, e.message);
    return { symbol, price: null };
  }
}

async function main() {
  const results = {};
  for (const symbol of Object.keys(tokens)) {
    results[symbol] = await fetchTokenPrice(symbol);
  }
  console.log('DIA Prices:', results);
}

main();
