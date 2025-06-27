require('dotenv').config();
const SimpleInstitutionalBot = require('./src/institutional/bot/SimpleInstitutionalBot');

async function main() {
    console.log('🏛️ Starting Institutional Flash Loan System Demo...');
    console.log('💡 This demo shows institutional-grade risk management and analytics');
    console.log('📊 Watch the logs for real-time monitoring and reporting\n');

    const bot = new SimpleInstitutionalBot();

    try {
        await bot.start();
        
        console.log('\n✅ Demo completed successfully!');
        console.log('📁 Check the logs/ and reports/ directories for generated files');
        console.log('🔍 Review the institutional-report.json for detailed analytics');
        
        // Keep running for a bit to show background processes
        console.log('\n⏰ Bot will continue running for 2 minutes to show background monitoring...');
        setTimeout(async () => {
            await bot.stop();
            console.log('\n🎯 Institutional Flash Loan System Demo Complete!');
            process.exit(0);
        }, 2 * 60 * 1000); // 2 minutes

    } catch (error) {
        console.error('❌ Demo failed:', error);
        process.exit(1);
    }
}

// Handle graceful shutdown
process.on('SIGINT', () => {
    console.log('\n🛑 Shutting down...');
    process.exit(0);
});

// Run the demo
main().catch(console.error);