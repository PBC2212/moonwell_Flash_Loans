const { ethers } = require("hardhat");

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log("🚀 Deploying mocks with account:", deployer.address);

  const MockERC20 = await ethers.getContractFactory("MockERC20");

  const usdc = await MockERC20.deploy("Mock USDC", "USDC", 6);
  await usdc.waitForDeployment();
  console.log("💵 USDC deployed:", await usdc.getAddress());

  const weth = await MockERC20.deploy("Mock WETH", "WETH", 18);
  await weth.waitForDeployment();
  console.log("💧 WETH deployed:", await weth.getAddress());

  const Vault = await ethers.getContractFactory("MockBalancerVault");
  const vault = await Vault.deploy();
  await vault.waitForDeployment();
  console.log("🏦 Vault deployed:", await vault.getAddress());

  const Comptroller = await ethers.getContractFactory("MockMoonwellComptroller");
  const comptroller = await Comptroller.deploy();
  await comptroller.waitForDeployment();
  console.log("🏛️ Comptroller deployed:", await comptroller.getAddress());

  const Router = await ethers.getContractFactory("MockDexRouter");
  const router = await Router.deploy();
  await router.waitForDeployment();
  console.log("🔁 DEX Router deployed:", await router.getAddress());

  console.log("\n📄 .env values to update:");
  console.log(`BALANCER_VAULT_ADDRESS=${await vault.getAddress()}`);
  console.log(`MOONWELL_COMPTROLLER_ADDRESS=${await comptroller.getAddress()}`);
  console.log(`USDT_ADDRESS=${await usdc.getAddress()}`);
  console.log(`WETH_ADDRESS=${await weth.getAddress()}`);
  console.log(`DEX_ROUTER_ADDRESS=${await router.getAddress()}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
