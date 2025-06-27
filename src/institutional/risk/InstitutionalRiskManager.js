const { ethers } = require('ethers');
const winston = require('winston');
const fs = require('fs');
const path = require('path');

// Ensure logs directory exists
const logsDir = path.join(__dirname, '../../../logs');
if (!fs.existsSync(logsDir)) {
    fs.mkdirSync(logsDir, { recursive: true });
}

class InstitutionalRiskManager {
    constructor() {
        this.logger = winston.createLogger({
            level: 'info',
            format: winston.format.combine(
                winston.format.timestamp(),
                winston.format.json()
            ),
            transports: [
                new winston.transports.File({ filename: path.join(logsDir, 'institutional-risk.log') }),
                new winston.transports.Console()
            ]
        });

        // Enhanced risk parameters for institutional operations
        this.riskLimits = {
            maxPositionSize: ethers.parseUnits('1000000', 6), // $1M max position
            maxDailyVolume: ethers.parseUnits('10000000', 6), // $10M daily limit
            maxSlippageBps: 300, // 3% max slippage
            minProfitThreshold: ethers.parseUnits('5000', 6), // $5K min profit
            maxGasPrice: ethers.parseUnits('100', 'gwei'),
            emergencyThreshold: ethers.parseUnits('100000', 6), // $100K emergency stop
            maxConcurrentOperations: 5,
            maxFailureRate: 0.1, // 10% max failure rate
            volatilityThreshold: 50, // High volatility threshold
            liquidityThreshold: 50 // Low liquidity threshold
        };

        // Advanced risk state tracking
        this.riskState = {
            dailyVolume: 0n,
            totalExposure: 0n,
            recentLosses: [],
            circuitBreakerActive: false,
            lastResetTime: Date.now(),
            currentOperations: 0,
            failureCount: 0,
            totalOperations: 0,
            riskScore: 0,
            marketCondition: 'normal'
        };

        this.marketMetrics = {
            volatilityScore: 0,
            liquidityScore: 100,
            gasCondition: 'normal',
            networkCongestion: 0,
            riskLevel: 'low'
        };

        this.blacklistedAddresses = new Set();
        this.startTime = Date.now();

        this.logger.info('🔒 Institutional Risk Manager initialized', {
            maxPositionSize: ethers.formatUnits(this.riskLimits.maxPositionSize, 6),
            maxDailyVolume: ethers.formatUnits(this.riskLimits.maxDailyVolume, 6)
        });
    }

    // Enhanced opportunity validation with institutional-grade risk scoring
    async validateOpportunity(opportunity) {
        try {
            const riskAssessment = {
                passed: true,
                reasons: [],
                riskScore: 0,
                adjustedParams: { ...opportunity },
                recommendations: []
            };

            // Basic validation
            if (!opportunity || !opportunity.amount || !opportunity.estimatedProfit) {
                riskAssessment.passed = false;
                riskAssessment.reasons.push('Invalid opportunity format');
                riskAssessment.riskScore = 100;
                return riskAssessment;
            }

            // Position size check
            if (opportunity.amount > this.riskLimits.maxPositionSize) {
                riskAssessment.passed = false;
                riskAssessment.reasons.push('Position size exceeds institutional limit');
                riskAssessment.riskScore += 50;
            }

            // Daily volume check with reset logic
            this.resetDailyLimitsIfNeeded();
            if (this.riskState.dailyVolume + opportunity.amount > this.riskLimits.maxDailyVolume) {
                riskAssessment.passed = false;
                riskAssessment.reasons.push('Daily volume limit exceeded');
                riskAssessment.riskScore += 30;
            }

            // Profit threshold with market condition adjustment
            const adjustedThreshold = this.calculateAdjustedProfitThreshold();
            if (opportunity.estimatedProfit < adjustedThreshold) {
                riskAssessment.passed = false;
                riskAssessment.reasons.push(`Profit below adjusted threshold: $${ethers.formatUnits(adjustedThreshold, 6)}`);
                riskAssessment.riskScore += 20;
            }

            // Market condition assessment
            const marketRisk = await this.assessMarketConditions(opportunity);
            riskAssessment.riskScore += marketRisk.score;
            
            if (marketRisk.circuitBreakerTriggered) {
                riskAssessment.passed = false;
                riskAssessment.reasons.push('Circuit breaker active due to adverse market conditions');
            }

            // Gas price check
            const gasRisk = await this.assessGasConditions(opportunity.network);
            riskAssessment.riskScore += gasRisk.score;
            if (gasRisk.tooHigh) {
                riskAssessment.passed = false;
                riskAssessment.reasons.push('Gas prices exceeding profitability threshold');
            }

            // Failure pattern detection
            if (this.detectSuspiciousLossPattern()) {
                riskAssessment.passed = false;
                riskAssessment.reasons.push('Suspicious loss pattern detected');
                riskAssessment.riskScore += 40;
            }

            // Concurrent operations limit
            if (this.riskState.currentOperations >= this.riskLimits.maxConcurrentOperations) {
                riskAssessment.passed = false;
                riskAssessment.reasons.push('Maximum concurrent operations limit reached');
                riskAssessment.riskScore += 25;
            }

            // Dynamic parameter adjustments
            riskAssessment.adjustedParams = this.adjustParametersBasedOnRisk(
                opportunity, 
                riskAssessment.riskScore
            );

            this.logger.info('🔍 Institutional risk assessment completed', {
                opportunityId: opportunity.id || 'unknown',
                passed: riskAssessment.passed,
                riskScore: riskAssessment.riskScore,
                marketCondition: this.riskState.marketCondition
            });

            return riskAssessment;

        } catch (error) {
            this.logger.error('❌ Risk assessment system failure', { error: error.message });
            return {
                passed: false,
                reasons: ['Risk assessment system error'],
                riskScore: 100,
                adjustedParams: opportunity,
                recommendations: ['System maintenance required']
            };
        }
    }

    // Market condition monitoring
    async assessMarketConditions(opportunity) {
        const assessment = {
            score: 0,
            circuitBreakerTriggered: false,
            adjustments: {},
            marketData: {}
        };

        try {
            // Volatility assessment (simplified for demo)
            const volatilityScore = Math.random() * 100;
            assessment.marketData.volatility = { score: volatilityScore };

            if (volatilityScore > this.riskLimits.volatilityThreshold) {
                assessment.score += 25;
                assessment.adjustments.reducePosition = 0.6;
                this.riskState.marketCondition = 'high_volatility';
            }

            // Liquidity analysis (simplified for demo)
            const liquidityScore = Math.random() * 100;
            assessment.marketData.liquidity = { score: liquidityScore };

            if (liquidityScore < this.riskLimits.liquidityThreshold) {
                assessment.score += 20;
                assessment.adjustments.increaseSlippage = 1.8;
            }

            // Network congestion (simplified for demo)
            const congestionScore = Math.random() * 100;
            assessment.marketData.network = { congestion: congestionScore };

            if (congestionScore > 80) {
                assessment.score += 15;
                assessment.adjustments.increaseGasLimit = 1.4;
            }

            // Circuit breaker logic
            if (assessment.score > 70 || this.detectSystemicRisk()) {
                assessment.circuitBreakerTriggered = true;
                this.activateCircuitBreaker('High systemic risk detected');
            }

            return assessment;

        } catch (error) {
            this.logger.error('⚠️ Market assessment failed', { error: error.message });
            return { 
                score: 40, 
                circuitBreakerTriggered: false, 
                adjustments: {},
                marketData: { error: 'Assessment failed' }
            };
        }
    }

    // Post-execution tracking
    async recordExecution(opportunity, result) {
        try {
            this.riskState.totalOperations++;
            this.riskState.currentOperations = Math.max(0, this.riskState.currentOperations - 1);
            
            if (opportunity.amount) {
                this.riskState.dailyVolume += opportunity.amount;
            }
            
            if (result.success) {
                this.updateSuccessMetrics(opportunity, result);
            } else {
                this.riskState.failureCount++;
                this.analyzeFailurePattern(opportunity, result);
            }

            // Emergency stop conditions
            if (this.shouldTriggerEmergencyStop(result)) {
                this.activateEmergencyProtocol(result);
            }

            this.logger.info('📊 Execution recorded in risk system', {
                opportunityId: opportunity.id || 'unknown',
                success: result.success,
                riskScore: this.riskState.riskScore,
                dailyVolume: ethers.formatUnits(this.riskState.dailyVolume, 6)
            });

        } catch (error) {
            this.logger.error('❌ Failed to record execution', { error: error.message });
        }
    }

    // Circuit breaker system
    activateCircuitBreaker(reason) {
        this.riskState.circuitBreakerActive = true;
        this.riskState.circuitBreakerReason = reason;
        this.riskState.circuitBreakerTimestamp = Date.now();

        this.logger.error('🚨 INSTITUTIONAL CIRCUIT BREAKER ACTIVATED', {
            reason: reason,
            timestamp: new Date().toISOString(),
            riskScore: this.riskState.riskScore
        });

        // Auto-reset after 10 minutes (in production, might need manual override)
        setTimeout(() => {
            this.deactivateCircuitBreaker();
        }, 10 * 60 * 1000);
    }

    deactivateCircuitBreaker() {
        this.riskState.circuitBreakerActive = false;
        this.logger.info('✅ Circuit breaker deactivated');
    }

    // Helper methods
    calculateAdjustedProfitThreshold() {
        let threshold = this.riskLimits.minProfitThreshold;
        
        if (this.marketMetrics.volatilityScore > 50) {
            threshold = threshold * BigInt(150) / BigInt(100);
        }
        
        if (this.marketMetrics.networkCongestion > 70) {
            threshold = threshold * BigInt(130) / BigInt(100);
        }
        
        return threshold;
    }

    async assessGasConditions(network) {
        try {
            // Simplified gas assessment (in production, connect to gas price APIs)
            const currentGasPrice = ethers.parseUnits('25', 'gwei');
            const score = currentGasPrice > this.riskLimits.maxGasPrice ? 30 : 0;
            const tooHigh = currentGasPrice > this.riskLimits.maxGasPrice * BigInt(2);
            
            return { score, tooHigh, currentPrice: currentGasPrice };
        } catch (error) {
            return { score: 15, tooHigh: false, error: error.message };
        }
    }

    detectSuspiciousLossPattern() {
        const recentLosses = this.riskState.recentLosses;
        const timeWindow = 60 * 60 * 1000; // 1 hour
        const now = Date.now();
        
        const recentHighFreqLosses = recentLosses.filter(
            loss => now - loss.timestamp < timeWindow
        );
        
        return recentHighFreqLosses.length > 3;
    }

    detectSystemicRisk() {
        return this.riskState.failureCount / Math.max(this.riskState.totalOperations, 1) > this.riskLimits.maxFailureRate;
    }

    adjustParametersBasedOnRisk(opportunity, riskScore) {
        const adjusted = { ...opportunity };
        
        if (riskScore > 30) {
            adjusted.maxSlippage = Math.min((opportunity.maxSlippage || 200) * 0.8, 150);
            if (adjusted.amount) {
                adjusted.amount = adjusted.amount * BigInt(80) / BigInt(100);
            }
        }
        
        if (riskScore > 50) {
            adjusted.priority = 'HIGH';
            adjusted.requiresApproval = true;
        }
        
        return adjusted;
    }

    resetDailyLimitsIfNeeded() {
        const now = Date.now();
        const daysSinceReset = (now - this.riskState.lastResetTime) / (24 * 60 * 60 * 1000);
        
        if (daysSinceReset >= 1) {
            this.riskState.dailyVolume = 0n;
            this.riskState.lastResetTime = now;
            this.logger.info('📅 Daily risk limits reset');
        }
    }

    updateSuccessMetrics(opportunity, result) {
        // Update success metrics - simplified implementation
        this.marketMetrics.riskLevel = 'low';
    }

    analyzeFailurePattern(opportunity, result) {
        this.riskState.recentLosses.push({
            amount: opportunity.amount || 0n,
            timestamp: Date.now(),
            reason: result.error || 'Unknown error',
            network: opportunity.network || 'unknown'
        });

        // Keep only recent losses (last 24 hours)
        const dayAgo = Date.now() - 24 * 60 * 60 * 1000;
        this.riskState.recentLosses = this.riskState.recentLosses.filter(
            loss => loss.timestamp > dayAgo
        );
    }

    shouldTriggerEmergencyStop(result) {
        return result.actualLoss && result.actualLoss > this.riskLimits.emergencyThreshold;
    }

    activateEmergencyProtocol(result) {
        this.riskState.circuitBreakerActive = true;
        this.logger.error('🚨 EMERGENCY STOP ACTIVATED', {
            reason: 'Large loss detected',
            loss: result.actualLoss ? ethers.formatUnits(result.actualLoss, 6) : 'unknown'
        });
    }

    // Public methods
    getRiskStatus() {
        return {
            circuitBreakerActive: this.riskState.circuitBreakerActive,
            riskScore: this.riskState.riskScore,
            marketCondition: this.riskState.marketCondition,
            dailyVolumeUsed: Number(this.riskState.dailyVolume) / 1e6,
            failureRate: this.riskState.totalOperations > 0 ? 
                this.riskState.failureCount / this.riskState.totalOperations : 0,
            currentOperations: this.riskState.currentOperations,
            uptime: Date.now() - this.startTime
        };
    }

    isHealthy() {
        return !this.riskState.circuitBreakerActive && 
               this.riskState.recentLosses.length < 3;
    }

    generateRiskReport() {
        return {
            timestamp: new Date().toISOString(),
            riskState: {
                ...this.riskState,
                dailyVolume: this.riskState.dailyVolume.toString(),
                totalExposure: this.riskState.totalExposure.toString()
            },
            riskLimits: {
                ...this.riskLimits,
                maxPositionSize: this.riskLimits.maxPositionSize.toString(),
                maxDailyVolume: this.riskLimits.maxDailyVolume.toString(),
                minProfitThreshold: this.riskLimits.minProfitThreshold.toString(),
                maxGasPrice: this.riskLimits.maxGasPrice.toString(),
                emergencyThreshold: this.riskLimits.emergencyThreshold.toString()
            },
            marketMetrics: this.marketMetrics,
            uptime: Date.now() - this.startTime
        };
    }
}

module.exports = InstitutionalRiskManager;