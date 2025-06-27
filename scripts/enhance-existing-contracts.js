const hre = require("hardhat");
require('dotenv').config();

async function enhanceExistingContracts() {
    console.log('🔧 Enhancing existing contracts with institutional features...');
    
    const [deployer] = await hre.ethers.getSigners();
    console.log('Deploying enhancements with account:', deployer.address);
    
    // Deploy institutional risk oracle
    const InstitutionalRiskOracle = await hre.ethers.getContractFactory("InstitutionalRiskOracle");
    const riskOracle = await InstitutionalRiskOracle.deploy();
    await riskOracle.waitForDeployment();
    
    console.log('✅ Institutional Risk Oracle deployed:', await riskOracle.getAddress());
    
    // Connect to your existing ProductionFlashLoanExecutor
    const existingExecutorAddress = process.env.FLASH_LOAN_EXECUTOR_BASE;
    if (existingExecutorAddress) {
        const ProductionFlashLoanExecutor = await hre.ethers.getContractFactory("ProductionFlashLoanExecutor");
        const executor = ProductionFlashLoanExecutor.attach(existingExecutorAddress);
        
        // Add institutional controls (if your contract supports it)
        try {
            const tx = await executor.setRiskOracle(await riskOracle.getAddress());
            await tx.wait();
            console.log('✅ Risk oracle integrated with existing contract');
        } catch (error) {
            console.log('⚠️ Could not integrate with existing contract (may need upgrade)');
            console.log('💡 Consider deploying new institutional contract version');
        }
    }
    
    return {
        riskOracle: await riskOracle.getAddress(),
        existingExecutor: existingExecutorAddress
    };
}

module.exports = { enhanceExistingContracts };

// Run if called directly
if (require.main === module) {
    enhanceExistingContracts().catch(console.error);
}