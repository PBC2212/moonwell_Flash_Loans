require('dotenv').config();
const SimpleInstitutionalBot = require('../src/institutional/bot/SimpleInstitutionalBot');

class ProductionIntegrationBot extends SimpleInstitutionalBot {
    constructor() {
        super();
        
        // Use production risk parameters
        this.riskManager.riskLimits.minProfitThreshold = ethers.parseUnits(process.env.MIN_PROFIT_THRESHOLD_USD || '5000', 6);
        this.riskManager.riskLimits.maxPositionSize = ethers.parseUnits(process.env.MAX_POSITION_SIZE_USD || '1000000', 6);
        this.riskManager.riskLimits.maxDailyVolume = ethers.parseUnits(process.env.DAILY_VOLUME_LIMIT_USD || '10000000', 6);
        
        console.log('🏭 Production Integration Mode Activated');
        console.log('🔒 Using institutional-grade risk parameters');
    }

    async integrateWithExistingBot(existingBotInstance) {
        console.log('🔗 Integrating with existing flash loan bot...');
        
        // Store original execution method
        const originalExecute = existingBotInstance.addToExecutionQueue?.bind(existingBotInstance);
        
        if (originalExecute) {
            // Override with institutional wrapper
            existingBotInstance.addToExecutionQueue = async (opportunity) => {
                console.log('🏛️ Routing through institutional risk management...');
                
                // Add institutional metadata
                opportunity.institutionalValidation = true;
                opportunity.validatedAt = Date.now();
                
                // Process through institutional controls
                const validation = await this.riskManager.validateOpportunity(opportunity);
                
                if (validation.passed) {
                    console.log('✅ Institutional approval granted');
                    
                    // Record the approval
                    await this.analytics.recordInstitutionalExecution(
                        opportunity,
                        { success: true, approved: true },
                        { riskScore: validation.riskScore }
                    );
                    
                    // Use adjusted parameters
                    return originalExecute(validation.adjustedParams);
                } else {
                    console.log('🚫 Institutional rejection:', validation.reasons);
                    
                    // Record the rejection
                    await this.analytics.recordInstitutionalExecution(
                        opportunity,
                        { success: false, rejected: true, reasons: validation.reasons },
                        { riskScore: validation.riskScore }
                    );
                    
                    return false;
                }
            };
            
            console.log('🎯 Integration complete - all opportunities now use institutional controls');
        } else {
            console.log('⚠️ Could not find addToExecutionQueue method in existing bot');
        }
    }

    async startProductionMode() {
        console.log('🏭 Starting Production Institutional Mode...');
        
        // Enhanced logging for production
        this.logger.info('Production mode activated', {
            riskLimits: {
                maxPositionSize: ethers.formatUnits(this.riskManager.riskLimits.maxPositionSize, 6),
                minProfitThreshold: ethers.formatUnits(this.riskManager.riskLimits.minProfitThreshold, 6),
                maxDailyVolume: ethers.formatUnits(this.riskManager.riskLimits.maxDailyVolume, 6)
            },
            environment: process.env.NODE_ENV,
            institutionalMode: true
        });
        
        await this.start();
        
        console.log('✅ Production institutional system ready');
        console.log('📊 Real-time monitoring active');
        console.log('🔒 Enterprise risk controls enabled');
    }
}

// Export for use in your existing system
module.exports = ProductionIntegrationBot;

// Example usage
if (require.main === module) {
    const productionBot = new ProductionIntegrationBot();
    productionBot.startProductionMode();
}