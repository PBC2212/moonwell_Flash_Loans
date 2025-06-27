const hre = require("hardhat");
require("dotenv").config();

async function main() {
  console.log("🚀 Deploying FlashLoanExecutor...");

  const balancerVault = process.env.BALANCER_VAULT_ADDRESS;
  const moonwellComptroller = process.env.MOONWELL_COMPTROLLER_ADDRESS;
  const dexRouter = process.env.DEX_ROUTER_ADDRESS;
  const weth = process.env.WETH_ADDRESS;
  const feeRecipient = process.env.FEE_RECIPIENT_ADDRESS;

  if (!balancerVault || !moonwellComptroller || !dexRouter || !weth || !feeRecipient) {
    throw new Error(
      "Please set BALANCER_VAULT_ADDRESS, MOONWELL_COMPTROLLER_ADDRESS, DEX_ROUTER_ADDRESS, WETH_ADDRESS, and FEE_RECIPIENT_ADDRESS in your .env"
    );
  }

  const FlashLoanExecutor = await hre.ethers.getContractFactory("FlashLoanExecutor");
  const flashLoanExecutor = await FlashLoanExecutor.deploy(
    balancerVault,
    moonwellComptroller,
    dexRouter,
    weth,
    feeRecipient
  );

  await flashLoanExecutor.deployed();

  console.log("🎉 FlashLoanExecutor deployed to:", flashLoanExecutor.address);
}

main()
  .then(() => process.exit(0))
  .catch(error => {
    console.error(error);
    process.exit(1);
  });
