const { ethers } = require('ethers');
const winston = require('winston');
const fs = require('fs');
const path = require('path');

// Ensure logs and reports directories exist
const logsDir = path.join(__dirname, '../../../logs');
const reportsDir = path.join(__dirname, '../../../reports');
if (!fs.existsSync(logsDir)) {
    fs.mkdirSync(logsDir, { recursive: true });
}
if (!fs.existsSync(reportsDir)) {
    fs.mkdirSync(reportsDir, { recursive: true });
}

class InstitutionalAnalytics {
    constructor() {
        this.logger = winston.createLogger({
            level: 'info',
            format: winston.format.combine(
                winston.format.timestamp(),
                winston.format.json()
            ),
            transports: [
                new winston.transports.File({ filename: path.join(logsDir, 'institutional-analytics.log') }),
                new winston.transports.Console()
            ]
        });

        // Comprehensive metrics tracking
        this.performanceMetrics = {
            totalPnL: 0n,
            totalVolume: 0n,
            totalOperations: 0,
            successfulOperations: 0,
            failedOperations: 0,
            avgExecutionTime: 0,
            totalGasUsed: 0n,
            totalFeesCollected: 0n,
            
            // Advanced performance metrics
            sharpeRatio: 0,
            maxDrawdown: 0,
            currentDrawdown: 0,
            winRate: 0,
            profitFactor: 0,
            riskAdjustedReturn: 0
        };

        // Network-specific analytics
        this.networkAnalytics = {
            base: this.initializeNetworkMetrics(),
            arbitrum: this.initializeNetworkMetrics(),
            polygon: this.initializeNetworkMetrics()
        };

        // Strategy performance tracking
        this.strategyAnalytics = {
            liquidation: this.initializeStrategyMetrics(),
            arbitrage: this.initializeStrategyMetrics(),
            sandwich: this.initializeStrategyMetrics()
        };

        // Historical data storage
        this.executionHistory = [];
        this.dailyMetrics = [];
        
        // Alert thresholds
        this.alertThresholds = {
            dailyLoss: ethers.parseUnits('100000', 6), // $100K daily loss
            drawdownLimit: 0.05, // 5% max drawdown
            errorRateLimit: 0.02, // 2% error rate
            uptimeRequirement: 0.999, // 99.9% uptime
            responseTimeLimit: 1000, // 1 second
            slippageAlert: 0.03 // 3% slippage alert
        };

        this.startTime = Date.now();
        
        this.logger.info('📊 Institutional Analytics initialized');
    }

    initializeNetworkMetrics() {
        return {
            totalPnL: 0n,
            totalVolume: 0n,
            operations: 0,
            successRate: 0,
            avgGasPrice: 0n,
            avgExecutionTime: 0,
            uniqueUsers: new Set(),
            peakVolume: 0n,
            errorTypes: {}
        };
    }

    initializeStrategyMetrics() {
        return {
            totalPnL: 0n,
            totalVolume: 0n,
            operations: 0,
            successRate: 0,
            avgProfitPerOp: 0,
            maxProfit: 0n,
            minProfit: 0n,
            riskScore: 0
        };
    }

    // Record comprehensive execution data
    async recordInstitutionalExecution(opportunity, result, executionMetrics = {}) {
        try {
            const executionData = {
                id: opportunity.id || `exec_${Date.now()}`,
                timestamp: Date.now(),
                user: opportunity.user || 'system',
                network: opportunity.network || 'unknown',
                strategy: opportunity.type || 'unknown',
                amount: opportunity.amount || 0n,
                estimatedProfit: opportunity.estimatedProfit || 0n,
                actualProfit: result.actualProfit || 0n,
                gasUsed: result.gasUsed || 0,
                gasPrice: executionMetrics.gasPrice || 0n,
                executionTime: executionMetrics.executionTime || 0,
                slippage: executionMetrics.slippage || 0,
                riskScore: executionMetrics.riskScore || 0,
                success: result.success || false,
                error: result.error || null,
                fees: result.fees || 0n,
                blockNumber: executionMetrics.blockNumber || 0,
                transactionHash: result.txHash || null
            };

            // Update core metrics
            await this.updateCoreMetrics(executionData);
            
            // Update network-specific metrics
            this.updateNetworkMetrics(executionData);
            
            // Update strategy-specific metrics
            this.updateStrategyMetrics(executionData);
            
            // Store execution for historical analysis
            this.executionHistory.push(executionData);
            
            // Trim history to manage memory (keep last 10,000 executions)
            if (this.executionHistory.length > 10000) {
                this.executionHistory = this.executionHistory.slice(-10000);
            }

            // Real-time alerting
            await this.checkInstitutionalAlerts(executionData);

            this.logger.info('📊 Institutional execution recorded', {
                id: executionData.id,
                profit: ethers.formatUnits(executionData.actualProfit, 6),
                network: executionData.network,
                strategy: executionData.strategy,
                riskScore: executionData.riskScore
            });

        } catch (error) {
            this.logger.error('❌ Failed to record institutional execution', { 
                error: error.message,
                opportunityId: opportunity.id || 'unknown'
            });
        }
    }

    // Update comprehensive performance metrics
    async updateCoreMetrics(executionData) {
        this.performanceMetrics.totalOperations++;
        this.performanceMetrics.totalVolume += executionData.amount;
        this.performanceMetrics.totalGasUsed += BigInt(executionData.gasUsed || 0);

        if (executionData.success) {
            this.performanceMetrics.successfulOperations++;
            this.performanceMetrics.totalPnL += executionData.actualProfit;
            this.performanceMetrics.totalFeesCollected += executionData.fees || 0n;
        } else {
            this.performanceMetrics.failedOperations++;
            if (executionData.actualProfit < 0) {
                this.performanceMetrics.totalPnL += executionData.actualProfit;
            }
        }

        // Calculate derived metrics
        this.calculateAdvancedMetrics();
        
        // Update execution time metrics
        this.updateExecutionTimeMetrics(executionData.executionTime);
    }

    calculateAdvancedMetrics() {
        const total = this.performanceMetrics.totalOperations;
        if (total === 0) return;

        // Basic ratios
        this.performanceMetrics.winRate = this.performanceMetrics.successfulOperations / total;
        this.performanceMetrics.errorRate = this.performanceMetrics.failedOperations / total;

        // Calculate other advanced metrics
        this.calculateDrawdownMetrics();
        this.calculateProfitFactor();
    }

    calculateDrawdownMetrics() {
        if (this.executionHistory.length < 2) return;

        let runningPnL = 0;
        let peak = 0;
        let maxDrawdown = 0;

        this.executionHistory.forEach(exec => {
            runningPnL += Number(exec.actualProfit);
            peak = Math.max(peak, runningPnL);
            
            const drawdown = peak > 0 ? (peak - runningPnL) / peak : 0;
            maxDrawdown = Math.max(maxDrawdown, drawdown);
        });

        this.performanceMetrics.maxDrawdown = maxDrawdown;
        this.performanceMetrics.currentDrawdown = peak > 0 ? (peak - runningPnL) / peak : 0;
    }

    calculateProfitFactor() {
        const profits = this.executionHistory
            .map(exec => Number(exec.actualProfit))
            .filter(profit => profit !== 0);

        if (profits.length === 0) return;

        const grossWins = profits.filter(p => p > 0).reduce((sum, p) => sum + p, 0);
        const grossLosses = Math.abs(profits.filter(p => p < 0).reduce((sum, p) => sum + p, 0));

        this.performanceMetrics.profitFactor = grossLosses > 0 ? grossWins / grossLosses : grossWins > 0 ? Infinity : 0;
    }

    updateNetworkMetrics(executionData) {
        const network = executionData.network;
        if (this.networkAnalytics[network]) {
            this.networkAnalytics[network].operations++;
            this.networkAnalytics[network].totalVolume += executionData.amount;
            if (executionData.success) {
                this.networkAnalytics[network].totalPnL += executionData.actualProfit;
            }
            this.networkAnalytics[network].successRate = 
                this.networkAnalytics[network].operations > 0 ? 
                (this.networkAnalytics[network].operations - (executionData.success ? 0 : 1)) / this.networkAnalytics[network].operations : 0;
        }
    }

    updateStrategyMetrics(executionData) {
        const strategy = executionData.strategy;
        if (this.strategyAnalytics[strategy]) {
            this.strategyAnalytics[strategy].operations++;
            this.strategyAnalytics[strategy].totalVolume += executionData.amount;
            if (executionData.success) {
                this.strategyAnalytics[strategy].totalPnL += executionData.actualProfit;
            }
            this.strategyAnalytics[strategy].successRate = 
                this.strategyAnalytics[strategy].operations > 0 ? 
                (this.strategyAnalytics[strategy].operations - (executionData.success ? 0 : 1)) / this.strategyAnalytics[strategy].operations : 0;
        }
    }

    updateExecutionTimeMetrics(executionTime) {
        if (this.performanceMetrics.totalOperations === 1) {
            this.performanceMetrics.avgExecutionTime = executionTime;
        } else {
            this.performanceMetrics.avgExecutionTime = 
                (this.performanceMetrics.avgExecutionTime * (this.performanceMetrics.totalOperations - 1) + executionTime) / 
                this.performanceMetrics.totalOperations;
        }
    }

    // Generate institutional-grade reports
    generateInstitutionalReport(timeframe = '24h', includeDetails = false) {
        const report = {
            reportType: 'INSTITUTIONAL_PERFORMANCE_ANALYSIS',
            timeframe,
            generatedAt: new Date().toISOString(),
            reportId: this.generateReportId(),
            
            executiveSummary: this.generateExecutiveSummary(timeframe),
            performanceMetrics: this.generatePerformanceSection(timeframe),
            riskAnalysis: this.generateRiskAnalysis(timeframe),
            networkBreakdown: this.generateNetworkBreakdown(timeframe),
            strategyBreakdown: this.generateStrategyBreakdown(timeframe),
            alerts: this.getActiveAlerts(),
            recommendations: this.generateInstitutionalRecommendations()
        };

        if (includeDetails) {
            report.detailedAnalysis = this.generateDetailedAnalysis(timeframe);
            report.rawData = this.getFilteredExecutions(timeframe).slice(-100);
        }

        return report;
    }

    generateExecutiveSummary(timeframe) {
        const executions = this.getFilteredExecutions(timeframe);
        const successful = executions.filter(e => e.success);
        const totalPnL = executions.reduce((sum, e) => sum + Number(e.actualProfit), 0);
        const totalVolume = executions.reduce((sum, e) => sum + Number(e.amount), 0);

        return {
            totalOperations: executions.length,
            successRate: executions.length > 0 ? (successful.length / executions.length * 100).toFixed(2) + '%' : '0%',
            totalPnL: `$${(totalPnL / 1e6).toFixed(2)}M`,
            totalVolume: `$${(totalVolume / 1e6).toFixed(2)}M`,
            avgProfitPerOperation: successful.length > 0 ? 
                `$${(totalPnL / successful.length / 1e6 * 1000).toFixed(0)}K` : '$0',
            roi: totalVolume > 0 ? `${(totalPnL / totalVolume * 100).toFixed(3)}%` : '0%',
            maxDrawdown: `${(this.performanceMetrics.maxDrawdown * 100).toFixed(2)}%`,
            systemUptime: this.calculateUptimePercentage().toFixed(3) + '%'
        };
    }

    generatePerformanceSection(timeframe) {
        const executions = this.getFilteredExecutions(timeframe);
        if (executions.length === 0) return {};

        const profits = executions.map(e => Number(e.actualProfit) / 1e6);
        const avgExecutionTime = executions.reduce((sum, e) => sum + e.executionTime, 0) / executions.length;

        return {
            avgProfit: profits.reduce((sum, p) => sum + p, 0) / profits.length,
            medianProfit: this.calculateMedian(profits),
            maxProfit: Math.max(...profits),
            minProfit: Math.min(...profits),
            avgExecutionTime: avgExecutionTime,
            profitFactor: this.performanceMetrics.profitFactor
        };
    }

    generateRiskAnalysis(timeframe) {
        const executions = this.getFilteredExecutions(timeframe);
        
        return {
            maxDrawdown: this.performanceMetrics.maxDrawdown,
            currentDrawdown: this.performanceMetrics.currentDrawdown,
            riskAdjustedReturn: this.performanceMetrics.riskAdjustedReturn,
            avgSlippage: executions.length > 0 ? 
                executions.reduce((sum, e) => sum + e.slippage, 0) / executions.length : 0,
            errorRate: this.performanceMetrics.errorRate
        };
    }

    generateNetworkBreakdown(timeframe) {
        const executions = this.getFilteredExecutions(timeframe);
        const networks = {};
        
        executions.forEach(exec => {
            if (!networks[exec.network]) {
                networks[exec.network] = {
                    operations: 0,
                    pnl: 0,
                    volume: 0,
                    successRate: 0
                };
            }
            networks[exec.network].operations++;
            networks[exec.network].pnl += Number(exec.actualProfit) / 1e6;
            networks[exec.network].volume += Number(exec.amount) / 1e6;
        });

        // Calculate success rates
        Object.keys(networks).forEach(network => {
            const networkExecs = executions.filter(e => e.network === network);
            const successful = networkExecs.filter(e => e.success);
            networks[network].successRate = networkExecs.length > 0 ? 
                successful.length / networkExecs.length : 0;
        });

        return networks;
    }

    generateStrategyBreakdown(timeframe) {
        const executions = this.getFilteredExecutions(timeframe);
        const strategies = {};
        
        executions.forEach(exec => {
            if (!strategies[exec.strategy]) {
                strategies[exec.strategy] = {
                    operations: 0,
                    pnl: 0,
                    volume: 0,
                    successRate: 0
                };
            }
            strategies[exec.strategy].operations++;
            strategies[exec.strategy].pnl += Number(exec.actualProfit) / 1e6;
            strategies[exec.strategy].volume += Number(exec.amount) / 1e6;
        });

        // Calculate success rates
        Object.keys(strategies).forEach(strategy => {
            const strategyExecs = executions.filter(e => e.strategy === strategy);
            const successful = strategyExecs.filter(e => e.success);
            strategies[strategy].successRate = strategyExecs.length > 0 ? 
                successful.length / strategyExecs.length : 0;
        });

        return strategies;
    }

    generateDetailedAnalysis(timeframe) {
        return {
            performanceAttribution: this.calculatePerformanceAttribution(timeframe),
            riskContribution: this.calculateRiskContribution(timeframe),
            executionQuality: this.calculateExecutionQuality(timeframe)
        };
    }

    calculatePerformanceAttribution(timeframe) {
        // Simplified performance attribution
        return {
            networkContribution: this.networkAnalytics,
            strategyContribution: this.strategyAnalytics
        };
    }

    calculateRiskContribution(timeframe) {
        // Simplified risk contribution analysis
        return {
            volatilityContribution: 0.3,
            liquidityContribution: 0.2,
            executionRisk: 0.5
        };
    }

    calculateExecutionQuality(timeframe) {
        const executions = this.getFilteredExecutions(timeframe);
        
        return {
            avgSlippage: executions.length > 0 ? 
                executions.reduce((sum, e) => sum + e.slippage, 0) / executions.length : 0,
            executionEfficiency: this.calculateExecutionEfficiency(executions)
        };
    }

    calculateExecutionEfficiency(executions) {
        if (executions.length === 0) return 0;
        
        const successful = executions.filter(e => e.success);
        return successful.length / executions.length;
    }

    generateInstitutionalRecommendations() {
        const recommendations = [];
        
        if (this.performanceMetrics.maxDrawdown > 0.03) {
            recommendations.push('Consider reducing position sizes due to elevated drawdown');
        }
        
        if (this.performanceMetrics.errorRate > 0.05) {
            recommendations.push('Review execution logic due to high error rate');
        }
        
        return recommendations;
    }

    // Real-time monitoring and alerting
    async checkInstitutionalAlerts(executionData) {
        const alerts = [];

        // Large P&L movements
        if (Math.abs(Number(executionData.actualProfit)) > Number(this.alertThresholds.dailyLoss) / 10) {
            alerts.push({
                type: 'LARGE_PNL_MOVEMENT',
                severity: Number(executionData.actualProfit) > 0 ? 'INFO' : 'WARNING',
                message: `Large ${Number(executionData.actualProfit) > 0 ? 'profit' : 'loss'}: $${Math.abs(Number(executionData.actualProfit)) / 1e6}M`,
                execution: executionData
            });
        }

        // High slippage alert
        if (executionData.slippage > this.alertThresholds.slippageAlert) {
            alerts.push({
                type: 'HIGH_SLIPPAGE',
                severity: 'WARNING',
                message: `High slippage detected: ${(executionData.slippage * 100).toFixed(2)}%`,
                execution: executionData
            });
        }

        // Process alerts
        for (const alert of alerts) {
            await this.processInstitutionalAlert(alert);
        }
    }

    async processInstitutionalAlert(alert) {
        this.logger.warn('🚨 Institutional Alert', alert);
        
        // In production, implement:
        // - Real-time dashboard updates
        // - Email notifications to risk team
        // - Slack/Teams integration
        // - PagerDuty for critical alerts
    }

    // Utility methods
    getFilteredExecutions(timeframe) {
        const now = Date.now();
        let timeWindow;

        switch (timeframe) {
            case '1h': timeWindow = 60 * 60 * 1000; break;
            case '24h': timeWindow = 24 * 60 * 60 * 1000; break;
            case '7d': timeWindow = 7 * 24 * 60 * 60 * 1000; break;
            case '30d': timeWindow = 30 * 24 * 60 * 60 * 1000; break;
            default: timeWindow = 24 * 60 * 60 * 1000;
        }

        return this.executionHistory.filter(exec => exec.timestamp > now - timeWindow);
    }

    calculateUptimePercentage() {
        // Simplified - in production, track actual downtime
        return 99.95;
    }

    calculateMedian(numbers) {
        if (numbers.length === 0) return 0;
        const sorted = numbers.sort((a, b) => a - b);
        const mid = Math.floor(sorted.length / 2);
        return sorted.length % 2 !== 0 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
    }

    generateReportId() {
        return `INST_RPT_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    }

    getActiveAlerts() {
        const alerts = [];
        
        if (this.performanceMetrics.currentDrawdown > this.alertThresholds.drawdownLimit) {
            alerts.push({
                type: 'HIGH_DRAWDOWN',
                severity: 'warning',
                value: this.performanceMetrics.currentDrawdown
            });
        }
        
        if (this.performanceMetrics.errorRate > this.alertThresholds.errorRateLimit) {
            alerts.push({
                type: 'HIGH_ERROR_RATE',
                severity: 'warning',
                value: this.performanceMetrics.errorRate
            });
        }
        
        return alerts;
    }

    // Export data for external analytics tools
    exportInstitutionalData(format = 'json', timeframe = '24h') {
        const data = {
            timestamp: Date.now(),
            timeframe,
            performanceMetrics: {
                ...this.performanceMetrics,
                totalPnL: this.performanceMetrics.totalPnL.toString(),
                totalVolume: this.performanceMetrics.totalVolume.toString(),
                totalGasUsed: this.performanceMetrics.totalGasUsed.toString(),
                totalFeesCollected: this.performanceMetrics.totalFeesCollected.toString()
            },
            networkAnalytics: this.networkAnalytics,
            strategyAnalytics: this.strategyAnalytics,
            recentExecutions: this.getFilteredExecutions(timeframe)
        };

        switch (format.toLowerCase()) {
            case 'json':
                return JSON.stringify(data, (key, value) =>
                    typeof value === 'bigint' ? value.toString() : value, 2);
            case 'csv':
                return this.convertToInstitutionalCSV(data);
            default:
                return data;
        }
    }

    convertToInstitutionalCSV(data) {
        // Simplified CSV conversion
        const headers = ['timestamp', 'network', 'strategy', 'amount', 'profit', 'success'];
        const rows = data.recentExecutions.map(exec => [
            exec.timestamp,
            exec.network,
            exec.strategy,
            exec.amount,
            exec.actualProfit,
            exec.success
        ]);

        return [headers, ...rows].map(row => row.join(',')).join('\n');
    }

    // Save report to file
    async saveReportToFile(report, filename = null) {
        try {
            const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
            const reportFilename = filename || `institutional-report-${timestamp}.json`;
            const filepath = path.join(reportsDir, reportFilename);
            
            const reportString = JSON.stringify(report, (key, value) =>
                typeof value === 'bigint' ? value.toString() : value, 2);
            
            fs.writeFileSync(filepath, reportString);
            
            this.logger.info('📄 Report saved to file', { filename: reportFilename });
            return filepath;
            
        } catch (error) {
            this.logger.error('❌ Failed to save report to file', { error: error.message });
            throw error;
        }
    }
}

module.exports = InstitutionalAnalytics;