require('dotenv').config();
const { ethers } = require("ethers");
const axios = require("axios");

// FlashLoanExecutor ABI
const executorAbi = [
  "function executeFlashLoan(address asset, uint256 amount, address pool, bytes calldata data) external"
];

// Network setup
const networks = {
  base: {
    name: "Base",
    provider: new ethers.providers.JsonRpcProvider(process.env.BASE_RPC),
    executor: process.env.BASE_EXECUTOR
  },
  arbitrum: {
    name: "Arbitrum",
    provider: new ethers.providers.JsonRpcProvider(process.env.ARBITRUM_RPC),
    executor: process.env.ARBITRUM_EXECUTOR
  },
  polygon: {
    name: "Polygon",
    provider: new ethers.providers.JsonRpcProvider(process.env.POLYGON_RPC),
    executor: process.env.POLYGON_EXECUTOR
  }
};

// Discord Alert
async function sendDiscord(message) {
  try {
    await axios.post(process.env.DISCORD_WEBHOOK_URL, { content: message });
  } catch (e) {
    console.error("Discord webhook failed:", e.message);
  }
}

// Flash loan execution function
async function executeFlashLoan(networkKey, asset, amount, pool, data = "0x") {
  const net = networks[networkKey];
  const wallet = new ethers.Wallet(process.env.PRIVATE_KEY, net.provider);
  const contract = new ethers.Contract(net.executor, executorAbi, wallet);

  try {
    const tx = await contract.executeFlashLoan(asset, amount, pool, data);
    await tx.wait();
    console.log(`✅ ${net.name}: Flash loan executed. Tx: ${tx.hash}`);
    await sendDiscord(`✅ ${net.name}: FlashLoan executed!\nHash: ${tx.hash}`);
  } catch (err) {
    console.error(`❌ ${net.name} failed:`, err.message);
    await sendDiscord(`❌ ${net.name} FlashLoan failed: ${err.message}`);
  }
}

// Example usage
(async () => {
  // Replace with real values
  const asset = "0xAssetAddressHere";
  const amount = ethers.utils.parseUnits("10000", 18); // 10,000 tokens
  const pool = "0xPoolAddressHere";

  await executeFlashLoan("base", asset, amount, pool);
})();
