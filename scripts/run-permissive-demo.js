require('dotenv').config();
const SimpleInstitutionalBot = require('../src/institutional/bot/SimpleInstitutionalBot');

class PermissiveDemoBot extends SimpleInstitutionalBot {
    constructor() {
        super();
        
        // Override risk manager with more permissive settings for demo
        this.riskManager.riskLimits.minProfitThreshold = this.ethers?.parseUnits('1000', 6) || 1000000000n; // $1K
        this.riskManager.riskLimits.maxPositionSize = this.ethers?.parseUnits('5000000', 6) || 5000000000000n; // $5M
        this.riskManager.riskLimits.maxFailureRate = 0.8; // 80% failure rate before circuit breaker
        
        console.log('🎮 Running in PERMISSIVE DEMO mode with relaxed risk controls');
    }

    // Override simulation to show more variety
    async simulateExecution(opportunity) {
        const startTime = Date.now();
        await new Promise(resolve => setTimeout(resolve, Math.random() * 1000 + 200));
        const executionTime = Date.now() - startTime;
        
        // Better success rate for demo (80% instead of 90%)
        const success = Math.random() > 0.2;
        
        if (success) {
            const profitMultiplier = 0.9 + Math.random() * 0.3; // 90-120% of estimated
            const actualProfit = opportunity.estimatedProfit * BigInt(Math.floor(profitMultiplier * 100)) / BigInt(100);
            
            return {
                success: true,
                actualProfit: actualProfit,
                gasUsed: Math.floor(Math.random() * 150000 + 80000),
                executionTime: executionTime,
                txHash: `0x${Math.random().toString(16).substr(2, 64)}`
            };
        } else {
            return {
                success: false,
                error: 'Simulated MEV competition',
                actualProfit: 0n,
                gasUsed: Math.floor(Math.random() * 30000 + 21000),
                executionTime: executionTime
            };
        }
    }
}

async function runPermissiveDemo() {
    console.log('🎮 Starting Permissive Institutional Demo...');
    console.log('💡 This demo uses relaxed risk parameters to show more variety\n');
    
    const bot = new PermissiveDemoBot();
    await bot.start();
    
    // Wait a bit for demo to complete
    setTimeout(async () => {
        console.log('\n📊 Permissive demo completed - check reports for results!');
        await bot.stop();
    }, 15000);
}

if (require.main === module) {
    runPermissiveDemo();
}

module.exports = PermissiveDemoBot;