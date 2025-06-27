const { ethers } = require('ethers');
const winston = require('winston');
const axios = require('axios');
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

        // DIA price cache object: { ETH: {symbol, price}, ... }
        this.diaPrices = {};

        this.logger.info('🤖 Flash Loan Execution Bot initialized');
    }

    // Start the bot and setup intervals including DIA price refresh
    async startBot() {
        this.logger.info('🚀 Starting Flash Loan Execution Bot...');
        this.isExecuting = true;

        // Initial DIA price fetch
        await this.fetchDiaPrices();

        // Refresh DIA prices every 60 seconds
        const diaInterval = setInterval(async () => {
            await this.fetchDiaPrices();
        }, 60 * 1000);
        this.intervals.push(diaInterval);

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

        const statsInterval = setInterval(() => {
            this.reportExecutionStats();
        }, 60000);
        this.intervals.push(statsInterval);

        this.logger.info('✅ Execution bot active - ready to make money!');
    }

    // Fetch current token prices from DIA API and cache them
    async fetchDiaPrices() {
        const tokens = ['ETH', 'WETH', 'DAI', 'USDC', 'BTC'];
        const prices = {};

        try {
            for (const token of tokens) {
                // Use DIA's token price by symbol endpoint:
                // https://api.diadata.org/v1/assetQuotation/Ethereum/<token_address>
                // We can use 'Ethereum' blockchain with address for tokens or fallback to example below
                // For simplicity here, we'll call by symbol, using the documented path:
                // GET /v1/assetQuotation/:blockchain/:asset
                // Using 'Ethereum' and token symbol or zero address for native tokens

                // We'll map tokens to their common Ethereum addresses or 0x0 for native ETH
                let blockchain = 'Ethereum';
                let assetAddress = '0x0000000000000000000000000000000000000000'; // For ETH native

                switch(token) {
                    case 'ETH':
                        blockchain = 'Ethereum';
                        assetAddress = '0x0000000000000000000000000000000000000000';
                        break;
                    case 'WETH':
                        blockchain = 'Ethereum';
                        assetAddress = '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2';
                        break;
                    case 'DAI':
                        blockchain = 'Ethereum';
                        assetAddress = '0x6B175474E89094C44Da98b954EedeAC495271d0F';
                        break;
                    case 'USDC':
                        blockchain = 'Ethereum';
                        assetAddress = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48';
                        break;
                    case 'BTC':
                        blockchain = 'Bitcoin';
                        assetAddress = '0x0000000000000000000000000000000000000000';
                        break;
                    default:
                        this.logger.warn(`⚠️ Unknown token for DIA fetch: ${token}`);
                        continue;
                }

                const url = `https://api.diadata.org/v1/assetQuotation/${blockchain}/${assetAddress}`;
                const response = await axios.get(url);

                if (response.data && response.data.Price) {
                    prices[token] = {
                        symbol: token,
                        price: response.data.Price
                    };
                } else {
                    this.logger.warn(`⚠️ DIA response missing price for ${token}`);
                    prices[token] = null;
                }
            }

            this.diaPrices = prices;
            this.logger.info('📡 DIA prices updated:', prices);

        } catch (error) {
            this.logger.error('❌ Error fetching DIA prices:', error.message || error);
        }
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

    // Add an opportunity after validating and simulating estimated profit using DIA prices
    async addToExecutionQueue(opportunity) {
        // Use DIA prices to simulate or adjust estimated profit
        try {
            // Example: simple profit adjustment based on DIA price of borrowed token
            if (this.diaPrices[opportunity.tokenSymbol]) {
                const price = this.diaPrices[opportunity.tokenSymbol].price;
                // Assume repayAmount is in token smallest unit, convert to token amount
                const tokenAmount = Number(ethers.formatUnits(opportunity.repayAmount || '0', 18));
                // Estimated profit = price * tokenAmount * some factor (simplified)
                opportunity.estimatedProfit = ethers.parseUnits((price * tokenAmount * 0.01).toFixed(6), 6);
            } else {
                // Fallback estimatedProfit if no price available
                opportunity.estimatedProfit = ethers.parseUnits("10000", 6);
            }
        } catch (err) {
            this.logger.warn('⚠️ Failed to calculate estimatedProfit from DIA prices:', err);
            opportunity.estimatedProfit = ethers.parseUnits("10000", 6);
        }

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
