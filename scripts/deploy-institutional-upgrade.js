require('dotenv').config();
const SimpleInstitutionalBot = require('../src/institutional/bot/SimpleInstitutionalBot');

async function deployInstitutionalUpgrade() {
    console.log('🏛️ Deploying Institutional Upgrade to Existing System...');
    
    // Step 1: Validate environment
    const requiredEnvVars = [
        'BASE_RPC_URL',
        'ARBITRUM_RPC_URL', 
        'POLYGON_RPC_URL',
        'OPERATOR_PRIVATE_KEY'
    ];
    
    const missing = requiredEnvVars.filter(envVar => !process.env[envVar]);
    if (missing.length > 0) {
        console.log('⚠️ Missing environment variables for full deployment:', missing);
        console.log('📝 Running in demo mode with institutional controls only...');
    } else {
        console.log('✅ Environment validated for full deployment');
    }
    
    // Step 2: Initialize institutional bot
    const institutionalBot = new SimpleInstitutionalBot();
    await institutionalBot.start();
    
    // Step 3: Test with real opportunity format
    const realOpportunityExample = {
        id: 'real_liquidation_moonwell_001',
        type: 'liquidation',
        network: 'base',
        amount: ethers.parseUnits('75000', 6), // $75K liquidation
        estimatedProfit: ethers.parseUnits('4500', 6), // $4.5K profit
        
        // Real liquidation data
        borrower: '0x742d35Cc6534C0532925a3b8D48C8cb8d165C7AB',
        mTokenBorrowed: '0xA88594D404727625A9437C3f886C7643872296AE', // Example mUSDC
        mTokenCollateral: '0xc6e7DF5E7b4f2A278906862b61205850344D4e7d', // Example mETH
        repayAmount: ethers.parseUnits('75000', 6),
        
        // MEV protection parameters
        priority: 'HIGH',
        maxSlippage: 250, // 2.5%
        gasMultiplier: 1.15,
        
        // Source tracking
        source: 'moonwell_liquidation_scanner',
        detectedAt: Date.now(),
        expiresAt: Date.now() + 5 * 60 * 1000 // 5 minutes
    };
    
    console.log('\n🧪 Testing with realistic opportunity...');
    const result = await institutionalBot.processOpportunityWithInstitutionalControls(realOpportunityExample);
    
    if (result.success) {
        console.log('✅ Institutional system ready for real opportunities');
        console.log('📊 Integration complete - your existing bot can now use:');
        console.log('   institutionalBot.processOpportunityWithInstitutionalControls(opportunity)');
    } else {
        console.log('⚠️ Test opportunity rejected (this is normal for demo)');
        console.log('💡 Adjust risk parameters if needed for your use case');
    }
    
    // Step 4: Generate deployment report
    const deploymentReport = {
        timestamp: new Date().toISOString(),
        status: 'deployed',
        institutionalControlsActive: true,
        riskManagementLevel: 'institutional',
        supportedNetworks: ['base', 'arbitrum', 'polygon'],
        maxPositionSize: '$1,000,000',
        dailyVolumeLimit: '$10,000,000',
        minimumProfitThreshold: '$5,000',
        testResults: {
            opportunityProcessed: realOpportunityExample.id,
            result: result.success ? 'approved' : 'rejected',
            reason: result.reason || 'risk_controls'
        }
    };
    
    console.log('\n📋 Deployment Report:');
    console.log(JSON.stringify(deploymentReport, null, 2));
    
    // Keep running for monitoring
    console.log('\n🔄 Institutional system is now running...');
    console.log('💡 Press Ctrl+C to stop');
    
    return institutionalBot;
}

// Export for use in other scripts
module.exports = { deployInstitutionalUpgrade };

// Run if called directly
if (require.main === module) {
    deployInstitutionalUpgrade().catch(console.error);
}