const axios = require('axios');

const DIA_API_URL = 'https://api.diadata.org/v1/markets/crypto-prices';

const wantedTokens = {
  '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE': 'ETH',
  '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2': 'WETH',
  '0x6B175474E89094C44Da98b954EedeAC495271d0F': 'DAI',
  '0xA0b86991c6218b36c1d19d4a2e9eb0ce3606eb48': 'USDC',
  '0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599': 'BTC',
};

async function fetchAllPrices() {
  try {
    const response = await axios.get(DIA_API_URL);

    const prices = {};

    if (response.data && Array.isArray(response.data)) {
      response.data.forEach(item => {
        // item looks like { "tokenAddress": "...", "price": "...", ... }
        const tokenAddress = item.tokenAddress || item.assetAddress;
        const symbol = wantedTokens[tokenAddress];
        if (symbol) {
          prices[symbol] = Number(item.price);
        }
      });
    }

    // Fill missing with null
    Object.values(wantedTokens).forEach(symbol => {
      if (!(symbol in prices)) prices[symbol] = null;
    });

    return prices;

  } catch (error) {
    console.error('Error fetching DIA prices:', error.message);
    return {};
  }
}

module.exports = { fetchAllPrices };
