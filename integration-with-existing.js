require('dotenv').config();
const { ethers } = require('ethers');
const SimpleInstitutionalBot = require('./src/institutional/bot/SimpleInstitutionalBot');

// Import your existing execution bot
const FlashLoanExecutionBot = require('./bots/execution-bot'); // Your existing bot

class IntegratedFlashLoanSystem {
    constructor() {
        this.institutionalBot = new SimpleInstitutionalBot();
        this.existingBot = new FlashLoanExecutionBot();
        this.isRunning = false;
    }

    async start() {
        console.log('🔄 Starting Integrated Flash Loan System...');
        
        // Start institutional controls
        await this.institutionalBot.start();
        
        // Start your existing bot
        await this.existingBot.startBot();
        
        // Override the existing bot's opportunity processing
        this.overrideExistingBotExecution();
        
        this.isRunning = true;
        console.log('✅ Integrated system operational with institutional controls');
    }

    overrideExistingBotExecution() {
        // Store original execution method
        const originalAddToQueue = this.existingBot.addToExecutionQueue.bind(this.existingBot);
        
        // Override with institutional controls
        this.existingBot.addToExecutionQueue = async (opportunity) => {
            console.log('🏛️ Routing through institutional risk management...');
            
            // Process through institutional controls first
            const result = await this.institutionalBot.processOpportunityWithInstitutionalControls(opportunity);
            
            if (result.success) {
                // If approved by institutional controls, proceed with original execution
                return originalAddToQueue(opportunity);
            } else {
                console.log('🚫 Opportunity blocked by institutional risk management:', result.reason);
                return false;
            }
        };
    }

    async stop() {
        if (this.existingBot) await this.existingBot.stopBot();
        if (this.institutionalBot) await this.institutionalBot.stop();
        this.isRunning = false;
    }

    getStatus() {
        return {
            institutional: this.institutionalBot.getStatus(),
            existing: this.existingBot.getStatus(),
            integrated: this.isRunning
        };
    }
}

// Usage
async function runIntegratedSystem() {
    const system = new IntegratedFlashLoanSystem();
    
    try {
        await system.start();
        
        // Keep running
        process.on('SIGINT', async () => {
            console.log('\n🛑 Shutting down integrated system...');
            await system.stop();
            process.exit(0);
        });
        
    } catch (error) {
        console.error('❌ Integration failed:', error);
    }
}

module.exports = { IntegratedFlashLoanSystem, runIntegratedSystem };

// Run if called directly
if (require.main === module) {
    runIntegratedSystem();
}