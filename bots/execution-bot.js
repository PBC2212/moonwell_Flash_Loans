const { ethers } = require('ethers');
const winston = require('winston');
require('dotenv').config();

class FlashLoanExecutionBot {
    constructor() {
        this.logger = winston.createLogger({
            level: 'info',
            format: winston.format.combine(
                winston.format.timestamp(),
                winston.format.json()
            ),
            transports: [
                new winston.transports.File({ filename: 'logs/execution.log' }),
                new winston.transports.Console()
            ]
        });

        this.providers = {
            base: new ethers.JsonRpcProvider(process.env.BASE_RPC_URL),
            arbitrum: new ethers.JsonRpcProvider(process.env.ARBITRUM_RPC_URL),
            polygon: new ethers.JsonRpcProvider(process.env.POLYGON_RPC_URL)
        };

        this.wallets = {
            base: new ethers.Wallet(process.env.OPERATOR_PRIVATE_KEY, this.providers.base),
            arbitrum: new ethers.Wallet(process.env.OPERATOR_PRIVATE_KEY, this.providers.arbitrum),
            polygon: new ethers.Wallet(process.env.OPERATOR_PRIVATE_KEY, this.providers.polygon)
        };

        this.contractAddresses = {
            base: process.env.FLASH_LOAN_EXECUTOR_BASE,
            arbitrum: process.env.FLASH_LOAN_EXECUTOR_ARBITRUM,
            polygon: process.env.FLASH_LOAN_EXECUTOR_POLYGON
        };

        this.contractABI = [
            "function executeEnterpriseOperation(string memory strategyType, address[] memory tokens, uint256[] memory amounts, bytes memory operationData) external",
            "function calculateLiquidationProfit(address borrower, address mTokenBorrowed, address mTokenCollateral, uint256 repayAmount) external view returns (bool profitable, uint256 estimatedProfit)",
            "event OperationExecuted(address indexed executor, string strategyType, uint256 actualProfit, uint256 gasUsed, uint256 timestamp)"
        ];

        this.executionQueue = [];
        this.isExecuting = false;
        this.executionStats = {
            totalExecuted: 0,
            totalProfit: 0n,
            successfulExecutions: 0,
            failedExecutions: 0
        };

        this.maxConcurrentExecutions = 3;
        this.currentExecutions = 0;
        this.maxRetries = 3;
        this.retryDelayMs = 3000;
        this.maxOpportunityAgeMs = 5 * 60 * 1000;
        this.intervals = [];

        this.logger.info('🤖 Flash Loan Execution Bot initialized');
    }

    async startBot() {
        this.logger.info('🚀 Starting Flash Loan Execution Bot...');
        this.isExecuting = true;

        const queueProcessor = setInterval(async () => {
            if (!this.isExecuting) return;

            this.cleanStaleOpportunities();

            while (
                this.currentExecutions < this.maxConcurrentExecutions &&
                this.executionQueue.length > 0
            ) {
                const opportunity = this.executionQueue.shift();
                this.currentExecutions++;
                this.executeWithRetry(opportunity)
                    .catch(e => this.logger.error('❌ Unexpected error in execution:', e))
                    .finally(() => {
                        this.currentExecutions--;
                    });
            }
        }, 2000);

        this.intervals.push(queueProcessor);

        // 🔴 Live detection API should go here (instead of simulated detection)
        // Example: Listen to a webhook or call external APIs periodically
        // e.g., this.integrateWithDexToolsOrMoonwell();

        const statsInterval = setInterval(() => {
            this.reportExecutionStats();
        }, 60000);
        this.intervals.push(statsInterval);

        this.logger.info('✅ Execution bot active - ready to make money!');
    }

    cleanStaleOpportunities() {
        const now = Date.now();
        const beforeLength = this.executionQueue.length;
        this.executionQueue = this.executionQueue.filter(
            op => now - op.timestamp <= this.maxOpportunityAgeMs
        );
        const removed = beforeLength - this.executionQueue.length;
        if (removed > 0) {
            this.logger.info(`🧹 Cleaned ${removed} stale opportunities from queue`);
        }
    }

    async executeWithRetry(opportunity, attempt = 1) {
        this.logger.info(`🚀 [Attempt ${attempt}] Executing opportunity: ${opportunity.id}`, {
            type: opportunity.type,
            network: opportunity.network,
            estimatedProfit: ethers.formatUnits(opportunity.estimatedProfit, 6)
        });

        try {
            const result = await this.executeFlashLoan(opportunity);

            if (result.success) {
                this.executionStats.successfulExecutions++;
                this.executionStats.totalProfit += result.actualProfit;

                this.logger.info(`✅ Execution successful!`, {
                    actualProfit: ethers.formatUnits(result.actualProfit, 6),
                    txHash: result.txHash,
                    gasUsed: result.gasUsed
                });

                await this.sendSuccessAlert(opportunity, result);
            } else {
                this.executionStats.failedExecutions++;
                this.logger.error(`❌ Execution failed: ${result.error}`);

                if (attempt < this.maxRetries) {
                    this.logger.info(`🔄 Retrying in ${this.retryDelayMs / 1000}s...`);
                    await this.delay(this.retryDelayMs * attempt);
                    return this.executeWithRetry(opportunity, attempt + 1);
                }
            }

            this.executionStats.totalExecuted++;

        } catch (error) {
            this.executionStats.failedExecutions++;
            this.executionStats.totalExecuted++;
            this.logger.error(`❌ Execution error for ${opportunity.id}:`, error);

            if (attempt < this.maxRetries) {
                this.logger.info(`🔄 Retrying in ${this.retryDelayMs / 1000}s...`);
                await this.delay(this.retryDelayMs * attempt);
                return this.executeWithRetry(opportunity, attempt + 1);
            }
        }
    }

    delay(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    async getGasPrice(network) {
        try {
            return await this.providers[network].getGasPrice();
        } catch (error) {
            this.logger.warn(`⚠️ Failed to fetch gas price for ${network}, using 10 gwei`);
            return ethers.parseUnits('10', 'gwei');
        }
    }

    async executeFlashLoan(opportunity) {
        try {
            const network = opportunity.network;
            const wallet = this.wallets[network];
            const contractAddress = this.contractAddresses[network];

            const contract = new ethers.Contract(contractAddress, this.contractABI, wallet);

            let strategyType, tokens, amounts, operationData;

            if (opportunity.type === 'liquidation') {
                strategyType = "liquidation";
                tokens = [opportunity.mTokenBorrowed];
                amounts = [opportunity.repayAmount];

                operationData = ethers.AbiCoder.defaultAbiCoder().encode(
                    ['address', 'address', 'address', 'uint256'],
                    [
                        opportunity.borrower,
                        opportunity.mTokenBorrowed,
                        opportunity.mTokenCollateral,
                        opportunity.repayAmount
                    ]
                );
            } else if (opportunity.type === 'arbitrage') {
                strategyType = "arbitrage";
                tokens = [opportunity.tokenA];
                amounts = [opportunity.amount];

                operationData = ethers.AbiCoder.defaultAbiCoder().encode(
                    ['address', 'address', 'address[]', 'uint24[]'],
                    [
                        opportunity.tokenA,
                        opportunity.tokenB,
                        ['0x1f9840a85d5aF5bf1D1762F925BDADdC4201F984'],
                        [3000]
                    ]
                );
            } else {
                throw new Error(`Unsupported strategy type: ${opportunity.type}`);
            }

            const gasEstimate = await contract.executeEnterpriseOperation.estimateGas(
                strategyType,
                tokens,
                amounts,
                operationData
            );

            const gasPrice = await this.getGasPrice(network);

            const tx = await contract.executeEnterpriseOperation(
                strategyType,
                tokens,
                amounts,
                operationData,
                {
                    gasLimit: gasEstimate.mul(120).div(100),
                    gasPrice: gasPrice
                }
            );

            this.logger.info(`📤 Transaction submitted: ${tx.hash}`);
            const receipt = await tx.wait();

            let actualProfit = opportunity.estimatedProfit;
            try {
                const iface = new ethers.Interface(this.contractABI);
                const event = receipt.events?.find(e => e.event === 'OperationExecuted');
                if (event) {
                    actualProfit = event.args.actualProfit;
                    this.logger.info(`📈 Parsed actual profit from event: ${ethers.formatUnits(actualProfit, 6)}`);
                }
            } catch (err) {
                this.logger.warn('⚠️ Event parse failed, using estimatedProfit');
            }

            return {
                success: true,
                txHash: tx.hash,
                actualProfit: actualProfit,
                gasUsed: receipt.gasUsed.toString()
            };

        } catch (error) {
            return {
                success: false,
                error: error.message
            };
        }
    }

    async addToExecutionQueue(opportunity) {
        if (await this.validateOpportunity(opportunity)) {
            opportunity.id = `${opportunity.type}_${opportunity.network}_${Date.now()}`;
            opportunity.timestamp = Date.now();
            this.executionQueue.push(opportunity);

            this.executionQueue.sort((a, b) => {
                const priorityOrder = { HIGH: 3, MEDIUM: 2, LOW: 1 };
                const priorityDiff = priorityOrder[b.priority] - priorityOrder[a.priority];
                return priorityDiff !== 0 ? priorityDiff : Number(b.estimatedProfit - a.estimatedProfit);
            });

            this.logger.info(`🎯 Opportunity queued: ${opportunity.type} on ${opportunity.network}`, {
                profit: ethers.formatUnits(opportunity.estimatedProfit, 6),
                priority: opportunity.priority,
                queueSize: this.executionQueue.length
            });
        }
    }

    async validateOpportunity(opportunity) {
        try {
            if (!this.contractAddresses[opportunity.network]) {
                this.logger.warn(`⚠️ No deployed contract for ${opportunity.network}`);
                return false;
            }

            const minProfit = ethers.parseUnits("5000", 6);
            if (opportunity.estimatedProfit < minProfit) {
                this.logger.warn(`⚠️ Profit too low: $${ethers.formatUnits(opportunity.estimatedProfit, 6)}`);
                return false;
            }

            if (opportunity.type === 'liquidation') {
                return await this.validateLiquidationOpportunity(opportunity);
            }

            return true;

        } catch (error) {
            this.logger.error('❌ Validation error:', error);
            return false;
        }
    }

    async validateLiquidationOpportunity(opportunity) {
        try {
            const contract = new ethers.Contract(
                this.contractAddresses[opportunity.network],
                this.contractABI,
                this.providers[opportunity.network]
            );

            const [profitable, estimatedProfit] = await contract.calculateLiquidationProfit(
                opportunity.borrower,
                opportunity.mTokenBorrowed,
                opportunity.mTokenCollateral,
                opportunity.repayAmount
            );

            if (!profitable) {
                this.logger.warn(`⚠️ Liquidation unprofitable for ${opportunity.borrower}`);
                return false;
            }

            opportunity.estimatedProfit = estimatedProfit;

            this.logger.info(`✅ Liquidation validated: $${ethers.formatUnits(estimatedProfit, 6)}`);
            return true;

        } catch (error) {
            this.logger.error('❌ Error validating liquidation:', error);
            return false;
        }
    }

    async sendSuccessAlert(opportunity, result) {
        const alertData = {
            title: '💰 FLASH LOAN PROFIT GENERATED!',
            network: opportunity.network,
            strategy: opportunity.type,
            profit: ethers.formatUnits(result.actualProfit, 6),
            txHash: result.txHash
        };

        const explorerLinks = {
            base: 'https://basescan.org/tx/',
            arbitrum: 'https://arbiscan.io/tx/',
            polygon: 'https://polygonscan.com/tx/'
        };

        const explorerUrl = explorerLinks[opportunity.network] + alertData.txHash;

        if (process.env.DISCORD_WEBHOOK_URL) {
            try {
                const axios = require('axios');
                await axios.post(process.env.DISCORD_WEBHOOK_URL, {
                    embeds: [{
                        title: alertData.title,
                        color: 65280,
                        fields: [
                            { name: 'Network', value: alertData.network.toUpperCase(), inline: true },
                            { name: 'Strategy', value: alertData.strategy.toUpperCase(), inline: true },
                            { name: 'Profit', value: `$${alertData.profit}`, inline: true },
                            { name: 'Transaction', value: `[View](${explorerUrl})`, inline: false }
                        ],
                        timestamp: new Date().toISOString()
                    }]
                });
            } catch (error) {
                this.logger.error('❌ Discord alert failed:', error);
            }
        }
    }

    reportExecutionStats() {
        const successRate = this.executionStats.totalExecuted > 0
            ? (this.executionStats.successfulExecutions / this.executionStats.totalExecuted * 100).toFixed(2)
            : 0;

        const avgProfit = this.executionStats.successfulExecutions > 0
            ? Number(this.executionStats.totalProfit) / this.executionStats.successfulExecutions / 1e6
            : 0;

        this.logger.info('📊 STATS', {
            totalExecuted: this.executionStats.totalExecuted,
            successful: this.executionStats.successfulExecutions,
            failed: this.executionStats.failedExecutions,
            successRate: `${successRate}%`,
            totalProfit: `$${Number(this.executionStats.totalProfit) / 1e6}`,
            avgProfitPerOp: `$${avgProfit.toFixed(0)}`,
            queueSize: this.executionQueue.length
        });
    }

    stopBot() {
        this.isExecuting = false;
        this.logger.info('🛑 Execution bot stopped');
        for (const interval of this.intervals) {
            clearInterval(interval);
        }
    }

    getStatus() {
        return {
            isExecuting: this.isExecuting,
            queueSize: this.executionQueue.length,
            stats: this.executionStats,
            networks: Object.keys(this.contractAddresses).filter(n => this.contractAddresses[n]),
            currentExecutions: this.currentExecutions
        };
    }
}

async function main() {
    const bot = new FlashLoanExecutionBot();
    await bot.startBot();

    process.on('SIGINT', () => {
        console.log('\n🛑 Shutting down execution bot...');
        bot.stopBot();
        process.exit(0);
    });

    console.log('🤖 Flash Loan Execution Bot Active');
    console.log('💰 Ready to execute $100K+ profitable opportunities');
    console.log('🎯 Press Ctrl+C to stop\n');
}

if (require.main === module) {
    main().catch(console.error);
}

module.exports = FlashLoanExecutionBot;
