const hre = require("hardhat");
const fs = require("fs");
require("dotenv").config();

async function main() {
  console.log("🚀 Starting Enterprise Flash Loan Executor deployment...");

  const [deployer] = await hre.ethers.getSigners();
  const balance = await hre.ethers.provider.getBalance(deployer.address);
  console.log("Deploying with account:", deployer.address);
  console.log("Account balance:", hre.ethers.formatEther(balance), "ETH");

  const networkAddresses = {
    11155111: { // Sepolia
      balancerVault: "0xBA12222222228d8Ba445958a75a0704d566BF2C8",
      moonwellComptroller: "0xfBb21d0380beE3312B33c4353c8936a0F13EF26C",
      dexRouter: "0x4752ba5dbc23f44d87826276bf6fd6b1c372ad24",
      weth: "0x7b79995e5f793A07Bc00c21412e50Ecae098E7f9",
      name: "Sepolia Testnet"
    },
    8453: { // Base
      balancerVault: "0xBA12222222228d8Ba445958a75a0704d566BF2C8",
      moonwellComptroller: "0xfBb21d0380beE3312B33c4353c8936a0F13EF26C",
      dexRouter: "0x2626664c2603336E57B271c5C0b26F421741e481",
      weth: "0x4200000000000000000000000000000000000006",
      name: "Base Mainnet"
    },
    42161: { // Arbitrum
      balancerVault: "0xBA12222222228d8Ba445958a75a0704d566BF2C8",
      moonwellComptroller: "0x8E00D5e02E65A19337Cdba98bbA9F84d4186a180",
      dexRouter: "0xE592427A0AEce92De3Edee1F18E0157C05861564",
      weth: "0x82aF49447D8a07e3bd95BD0d56f35241523fBab1",
      name: "Arbitrum Mainnet"
    },
    137: { // Polygon
      balancerVault: "0xBA12222222228d8Ba445958a75a0704d566BF2C8",
      moonwellComptroller: "0x8849F1a0cB6b5D6076aB150546EddEe193754F1C",
      dexRouter: "0xE592427A0AEce92De3Edee1F18E0157C05861564",
      weth: "0x0d500B1d8E8eF31E21C99d1Db9A6444d3ADf1270",
      name: "Polygon Mainnet"
    }
  };

  const network = await hre.ethers.provider.getNetwork();
  const chainId = Number(network.chainId);
  const addresses = networkAddresses[chainId];

  console.log(`Deploying to: ${addresses?.name || 'Unknown'} (Chain ID: ${chainId})`);

  if (!addresses) {
    throw new Error(`Unsupported chain ID: ${chainId}`);
  }

  console.log("Using addresses:");
  console.log("- Balancer Vault:", addresses.balancerVault);
  console.log("- Moonwell Comptroller:", addresses.moonwellComptroller);
  console.log("- DEX Router:", addresses.dexRouter);
  console.log("- WETH:", addresses.weth);

  const FlashLoanExecutor = await hre.ethers.getContractFactory("ProductionFlashLoanExecutor");
  const flashLoanExecutor = await FlashLoanExecutor.deploy(
    addresses.balancerVault,
    addresses.moonwellComptroller,
    addresses.dexRouter,
    addresses.weth,
    deployer.address // Fee recipient
  );

  await flashLoanExecutor.waitForDeployment();
  const tx = flashLoanExecutor.deploymentTransaction();
  const receipt = await tx.wait();

  console.log("\n✅ Enterprise deployment successful!");
  console.log("Contract Address:", flashLoanExecutor.target);
  console.log("Transaction Hash:", tx.hash);
  console.log("Gas Used:", receipt.gasUsed.toString());

  const deploymentInfo = {
    contractAddress: flashLoanExecutor.target,
    deployerAddress: deployer.address,
    networkName: addresses.name,
    chainId: chainId,
    transactionHash: tx.hash,
    blockNumber: receipt.blockNumber.toString(),
    gasUsed: receipt.gasUsed.toString(),
    timestamp: new Date().toISOString(),
    constructorArgs: [
      addresses.balancerVault,
      addresses.moonwellComptroller,
      addresses.dexRouter,
      addresses.weth,
      deployer.address
    ]
  };

  const deploymentDir = './deployments';
  if (!fs.existsSync(deploymentDir)) {
    fs.mkdirSync(deploymentDir, { recursive: true });
  }

  const deploymentPath = `${deploymentDir}/${addresses.name.toLowerCase().replace(/ /g, "_")}_deployment.json`;
  fs.writeFileSync(deploymentPath, JSON.stringify(deploymentInfo, null, 2));
  console.log(`📝 Deployment info saved: ${deploymentPath}`);

  console.log("\n🔍 To verify, run:");
  console.log(`npx hardhat verify --network ${network.name} ${flashLoanExecutor.target} "${addresses.balancerVault}" "${addresses.moonwellComptroller}" "${addresses.dexRouter}" "${addresses.weth}" "${deployer.address}"`);

  return {
    contractAddress: flashLoanExecutor.target,
    deploymentInfo
  };
}

main()
  .then((res) => {
    console.log("\n🎉 Enterprise deployment completed!");
    console.log("💰 Ready for $100K+ operations");
    console.log("Contract Address:", res.contractAddress);
    process.exit(0);
  })
  .catch((err) => {
    console.error("❌ Deployment failed:", err);
    process.exit(1);
  });

module.exports = { main };