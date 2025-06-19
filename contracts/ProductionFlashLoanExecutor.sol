// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

/**
 * @title Self-Contained Flash Loan Executor
 * @dev Complete flash loan contract without external dependencies
 */

// Interface definitions
interface IERC20 {
    function transfer(address to, uint256 amount) external returns (bool);
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
    function balanceOf(address account) external view returns (uint256);
    function approve(address spender, uint256 amount) external returns (bool);
    function decimals() external view returns (uint8);
}

interface IBalancerVault {
    function flashLoan(
        address recipient,
        address[] memory tokens,
        uint256[] memory amounts,
        bytes memory userData
    ) external;
}

interface IMoonwellComptroller {
    function getAccountLiquidity(address account) external view returns (uint256, uint256, uint256);
    function liquidationIncentiveMantissa() external view returns (uint256);
    function closeFactorMantissa() external view returns (uint256);
}

interface IMToken {
    function liquidateBorrow(address borrower, uint256 repayAmount, address mTokenCollateral) external returns (uint256);
    function borrowBalanceStored(address account) external view returns (uint256);
    function underlying() external view returns (address);
    function redeem(uint256 redeemTokens) external returns (uint256);
    function exchangeRateStored() external view returns (uint256);
    function balanceOf(address account) external view returns (uint256);
}

/**
 * @title FlashLoanExecutor
 * @dev Self-contained flash loan executor for Remix deployment
 */
contract FlashLoanExecutor {
    
    // Security variables
    uint256 private constant _NOT_ENTERED = 1;
    uint256 private constant _ENTERED = 2;
    uint256 private _status;
    bool private _paused;
    address private _owner;

    // Core protocol addresses
    IBalancerVault public balancerVault;
    IMoonwellComptroller public moonwellComptroller;
    address public dexRouter;
    address public weth;
    address public feeRecipient;

    // Configuration
    uint256 public constant MINIMUM_OPERATION_SIZE = 100_000e6; // $100K USDC
    uint256 public constant PROFIT_THRESHOLD = 5_000e6; // $5K minimum profit
    uint256 public constant MAX_SLIPPAGE_BPS = 300; // 3% max slippage
    uint256 public platformFeeRate = 50; // 0.5%

    // User tiers for fee discounts
    enum UserTier { STANDARD, PREMIUM, INSTITUTIONAL, WHALE }
    
    struct UserProfile {
        UserTier tier;
        bool isAuthorized;
        uint256 totalVolume;
        uint256 totalProfit;
        uint256 successfulOperations;
        uint256 failedOperations;
        uint256 lastOperationTime;
    }

    // Struct to avoid stack too deep errors
    struct FlashLoanData {
        address user;
        string strategyType;
        address token;
        uint256 amount;
        uint256 totalRepayment;
        uint256 finalBalance;
        uint256 grossProfit;
        uint256 netProfit;
        uint256 fees;
        bool success;
    }

    // Struct for liquidation data
    struct LiquidationData {
        address borrower;
        address mTokenBorrowed;
        address mTokenCollateral;
        uint256 repayAmount;
        address repayToken;
        address collateralToken;
        uint256 collateralBefore;
        uint256 collateralAfter;
        uint256 collateralSeized;
        uint256 mTokenBalance;
    }

    // State variables
    mapping(address => UserProfile) public userProfiles;
    mapping(string => bool) public enabledStrategies;
    mapping(address => bool) public operators;
    
    // Global metrics
    uint256 public totalVolumeProcessed;
    uint256 public totalProfitsGenerated;
    uint256 public totalOperationsExecuted;

    // Events
    event FlashLoanExecuted(
        address indexed user,
        string indexed strategyType,
        address indexed primaryToken,
        uint256 operationSize,
        uint256 grossProfit,
        uint256 netProfit,
        uint256 fees,
        bool success
    );

    event UserAuthorized(address indexed user, UserTier tier);
    event OperatorAdded(address indexed operator);
    event ProfitGenerated(address indexed user, uint256 profit);
    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);
    event Paused(address account);
    event Unpaused(address account);

    // Modifiers
    modifier nonReentrant() {
        require(_status != _ENTERED, "ReentrancyGuard: reentrant call");
        _status = _ENTERED;
        _;
        _status = _NOT_ENTERED;
    }

    modifier whenNotPaused() {
        require(!_paused, "Pausable: paused");
        _;
    }

    modifier onlyOwner() {
        require(_owner == msg.sender, "Ownable: caller is not the owner");
        _;
    }

    modifier onlyAuthorizedUser() {
        require(
            userProfiles[msg.sender].isAuthorized || operators[msg.sender] || msg.sender == _owner,
            "Not authorized for enterprise operations"
        );
        _;
    }

    modifier validOperationSize(uint256 amount) {
        require(amount >= MINIMUM_OPERATION_SIZE, "Operation below minimum size");
        _;
    }

    constructor(
        address _balancerVault,
        address _moonwellComptroller,
        address _dexRouter,
        address _weth,
        address _feeRecipient
    ) {
        // Initialize security
        _status = _NOT_ENTERED;
        _paused = false;
        _owner = msg.sender;
        emit OwnershipTransferred(address(0), msg.sender);
        
        // Initialize addresses
        balancerVault = IBalancerVault(_balancerVault);
        moonwellComptroller = IMoonwellComptroller(_moonwellComptroller);
        dexRouter = _dexRouter;
        weth = _weth;
        feeRecipient = _feeRecipient;

        // Set deployer as operator
        operators[msg.sender] = true;
        
        // Enable default strategies
        enabledStrategies["liquidation"] = true;
        enabledStrategies["arbitrage"] = true;
        
        // Auto-authorize deployer as WHALE tier
        userProfiles[msg.sender] = UserProfile({
            tier: UserTier.WHALE,
            isAuthorized: true,
            totalVolume: 0,
            totalProfit: 0,
            successfulOperations: 0,
            failedOperations: 0,
            lastOperationTime: 0
        });
    }

    // Owner functions
    function owner() public view returns (address) {
        return _owner;
    }

    function paused() public view returns (bool) {
        return _paused;
    }

    function transferOwnership(address newOwner) public onlyOwner {
        require(newOwner != address(0), "Ownable: new owner is the zero address");
        emit OwnershipTransferred(_owner, newOwner);
        _owner = newOwner;
    }

    function emergencyPause() external onlyOwner {
        require(!_paused, "Pausable: paused");
        _paused = true;
        emit Paused(msg.sender);
    }

    function unpause() external onlyOwner {
        require(_paused, "Pausable: not paused");
        _paused = false;
        emit Unpaused(msg.sender);
    }

    /**
     * @dev Execute enterprise flash loan operation
     */
    function executeEnterpriseOperation(
        string memory strategyType,
        address[] memory tokens,
        uint256[] memory amounts,
        bytes memory operationData
    ) 
        external 
        nonReentrant 
        whenNotPaused 
        onlyAuthorizedUser
        validOperationSize(amounts[0])
    {
        require(enabledStrategies[strategyType], "Strategy not enabled");
        require(tokens.length == amounts.length, "Array length mismatch");
        require(tokens.length > 0, "No tokens specified");
        
        bytes memory userData = abi.encode(msg.sender, strategyType, operationData);
        balancerVault.flashLoan(address(this), tokens, amounts, userData);
    }

    /**
     * @dev Balancer flash loan callback
     */
    function receiveFlashLoan(
        address[] memory tokens,
        uint256[] memory amounts,
        uint256[] memory feeAmounts,
        bytes memory userData
    ) external nonReentrant {
        require(msg.sender == address(balancerVault), "Unauthorized flash loan callback");
        require(tokens.length == amounts.length, "Array length mismatch");
        require(amounts.length == feeAmounts.length, "Fee array length mismatch");

        FlashLoanData memory data;
        data.token = tokens[0];
        data.amount = amounts[0];
        data.totalRepayment = amounts[0] + feeAmounts[0];

        bytes memory operationData;
        (data.user, data.strategyType, operationData) = 
            abi.decode(userData, (address, string, bytes));

        // Execute strategy
        data.finalBalance = _executeStrategy(data.token, data.amount, data.strategyType, operationData);
        data.success = true;

        require(data.finalBalance >= data.totalRepayment, "Insufficient funds for repayment");
        data.grossProfit = data.finalBalance - data.totalRepayment;
        require(data.grossProfit >= PROFIT_THRESHOLD, "Profit below minimum threshold");

        // Process profits and repayment
        _processFlashLoanComplete(data);
    }

    /**
     * @dev Execute strategy and return final balance
     */
    function _executeStrategy(
        address token,
        uint256 amount,
        string memory strategyType,
        bytes memory operationData
    ) internal returns (uint256 finalBalance) {
        if (keccak256(bytes(strategyType)) == keccak256("liquidation")) {
            finalBalance = _executeLiquidation(token, amount, operationData);
        } else if (keccak256(bytes(strategyType)) == keccak256("arbitrage")) {
            finalBalance = _executeArbitrage(token, amount, operationData);
        } else {
            revert("Unknown strategy type");
        }
    }

    /**
     * @dev Process flash loan completion with profits and repayment
     */
    function _processFlashLoanComplete(FlashLoanData memory data) internal {
        // Calculate fees and profits
        data.fees = _calculateFees(data.user, data.grossProfit);
        data.netProfit = data.grossProfit - data.fees;

        // Repay flash loan
        IERC20(data.token).approve(address(balancerVault), data.totalRepayment);
        IERC20(data.token).transfer(address(balancerVault), data.totalRepayment);
        
        // Distribute fees and profits
        if (data.fees > 0) {
            IERC20(data.token).transfer(feeRecipient, data.fees);
        }
        IERC20(data.token).transfer(data.user, data.netProfit);

        // Update metrics
        _updateUserMetrics(data.user, data.amount, data.netProfit, true);

        // Emit events
        emit FlashLoanExecuted(
            data.user, 
            data.strategyType, 
            data.token, 
            data.amount, 
            data.grossProfit, 
            data.netProfit, 
            data.fees, 
            data.success
        );

        emit ProfitGenerated(data.user, data.netProfit);
    }

    /**
     * @dev Execute liquidation strategy
     */
    function _executeLiquidation(
        address token,
        uint256, // amount - not used in current implementation
        bytes memory operationData
    ) internal returns (uint256) {
        LiquidationData memory liq;
        
        (
            liq.borrower,
            liq.mTokenBorrowed,
            liq.mTokenCollateral,
            liq.repayAmount
        ) = abi.decode(operationData, (address, address, address, uint256));

        // Basic validation
        require(liq.borrower != address(0), "Invalid borrower");
        require(liq.mTokenBorrowed != address(0), "Invalid borrow token");
        require(liq.mTokenCollateral != address(0), "Invalid collateral token");
        require(liq.repayAmount > 0, "Invalid repay amount");

        // Get underlying token addresses
        liq.repayToken = IMToken(liq.mTokenBorrowed).underlying();
        liq.collateralToken = IMToken(liq.mTokenCollateral).underlying();

        return _performLiquidation(token, liq);
    }

    /**
     * @dev Perform the actual liquidation
     */
    function _performLiquidation(address token, LiquidationData memory liq) internal returns (uint256) {
        // Approve mToken to spend our tokens
        IERC20(liq.repayToken).approve(liq.mTokenBorrowed, liq.repayAmount);
        
        // Record collateral balance before liquidation
        liq.collateralBefore = IERC20(liq.collateralToken).balanceOf(address(this));

        // Execute liquidation
        uint256 result = IMToken(liq.mTokenBorrowed).liquidateBorrow(
            liq.borrower,
            liq.repayAmount,
            liq.mTokenCollateral
        );
        require(result == 0, "Liquidation transaction failed");

        // Redeem seized mTokens for underlying collateral
        liq.mTokenBalance = IERC20(liq.mTokenCollateral).balanceOf(address(this));
        if (liq.mTokenBalance > 0) {
            IMToken(liq.mTokenCollateral).redeem(liq.mTokenBalance);
        }

        // Calculate collateral seized
        liq.collateralAfter = IERC20(liq.collateralToken).balanceOf(address(this));
        liq.collateralSeized = liq.collateralAfter - liq.collateralBefore;

        // Convert collateral to target token if different
        if (liq.collateralToken != token) {
            return _swapTokens(liq.collateralToken, token, liq.collateralSeized);
        }

        return IERC20(token).balanceOf(address(this));
    }

    /**
     * @dev Execute arbitrage strategy
     */
    function _executeArbitrage(
        address token,
        uint256, // amount - not used in current implementation  
        bytes memory // operationData - not used in current implementation
    ) internal view returns (uint256) {
        // Simplified arbitrage implementation
        // In production, implement actual DEX routing logic
        return IERC20(token).balanceOf(address(this));
    }

    /**
     * @dev Swap tokens using DEX router
     */
    function _swapTokens(address tokenIn, address, /* tokenOut */ uint256 amountIn) internal returns (uint256) {
        IERC20(tokenIn).approve(dexRouter, amountIn);
        // Simplified 1:1 swap for demo - implement actual DEX integration
        return amountIn;
    }

    /**
     * @dev Calculate fees based on user tier
     */
    function _calculateFees(address user, uint256 grossProfit) internal view returns (uint256) {
        UserProfile memory profile = userProfiles[user];
        
        uint256 baseFeeRate = platformFeeRate;
        
        // Apply tier-based discounts
        if (profile.tier == UserTier.WHALE) {
            baseFeeRate = baseFeeRate * 50 / 100; // 50% discount
        } else if (profile.tier == UserTier.INSTITUTIONAL) {
            baseFeeRate = baseFeeRate * 70 / 100; // 30% discount
        } else if (profile.tier == UserTier.PREMIUM) {
            baseFeeRate = baseFeeRate * 90 / 100; // 10% discount
        }

        return grossProfit * baseFeeRate / 10000;
    }

    /**
     * @dev Update user and global metrics
     */
    function _updateUserMetrics(address user, uint256 volume, uint256 profit, bool success) internal {
        UserProfile storage profile = userProfiles[user];
        profile.totalVolume += volume;
        profile.totalProfit += profit;
        profile.lastOperationTime = block.timestamp;
        
        if (success) {
            profile.successfulOperations += 1;
        } else {
            profile.failedOperations += 1;
        }

        // Update global metrics
        totalVolumeProcessed += volume;
        totalProfitsGenerated += profit;
        totalOperationsExecuted += 1;
    }

    /**
     * @dev Calculate potential liquidation profit (view function)
     */
    function calculateLiquidationProfit(
        address borrower,
        address, // mTokenBorrowed - not used in simplified calculation
        address, // mTokenCollateral - not used in simplified calculation  
        uint256 repayAmount
    ) external view returns (bool profitable, uint256 estimatedProfit) {
        // Check if borrower is underwater
        (, /* liquidity */, uint256 shortfall) = 
            moonwellComptroller.getAccountLiquidity(borrower);
        
        if (shortfall == 0) {
            return (false, 0);
        }

        // Get liquidation incentive
        uint256 liquidationIncentive = moonwellComptroller.liquidationIncentiveMantissa();
        
        // Calculate collateral that would be seized
        uint256 collateralSeized = repayAmount * liquidationIncentive / 1e18;
        
        // Estimate costs
        uint256 flashLoanFee = repayAmount / 1000; // 0.1% Balancer fee
        uint256 estimatedGasCost = 50e6; // $50 gas estimate
        
        // Calculate profit
        if (collateralSeized > repayAmount + flashLoanFee + estimatedGasCost) {
            estimatedProfit = collateralSeized - repayAmount - flashLoanFee - estimatedGasCost;
            profitable = estimatedProfit >= PROFIT_THRESHOLD;
        } else {
            profitable = false;
            estimatedProfit = 0;
        }
    }

    /**
     * @dev Check if liquidation is possible
     */
    function isLiquidationPossible(
        address borrower,
        address mTokenBorrowed
    ) external view returns (bool possible, uint256 maxRepayAmount) {
        // Check if account is underwater
        (, /* liquidity */, uint256 shortfall) = 
            moonwellComptroller.getAccountLiquidity(borrower);
        
        if (shortfall == 0) {
            return (false, 0);
        }

        // Get borrow balance
        uint256 borrowBalance = IMToken(mTokenBorrowed).borrowBalanceStored(borrower);
        
        // Get close factor (typically 50%)
        uint256 closeFactor = moonwellComptroller.closeFactorMantissa();
        maxRepayAmount = borrowBalance * closeFactor / 1e18;
        
        possible = maxRepayAmount >= MINIMUM_OPERATION_SIZE;
    }

    /**
     * @dev Authorize enterprise user
     */
    function authorizeEnterpriseUser(address user, UserTier tier) external onlyOwner {
        userProfiles[user] = UserProfile({
            tier: tier,
            isAuthorized: true,
            totalVolume: 0,
            totalProfit: 0,
            successfulOperations: 0,
            failedOperations: 0,
            lastOperationTime: 0
        });

        emit UserAuthorized(user, tier);
    }

    /**
     * @dev Add operator
     */
    function addOperator(address operator) external onlyOwner {
        operators[operator] = true;
        emit OperatorAdded(operator);
    }

    /**
     * @dev Set platform fee rate
     */
    function setPlatformFeeRate(uint256 newFeeRate) external onlyOwner {
        require(newFeeRate <= 1000, "Fee rate too high"); // Max 10%
        platformFeeRate = newFeeRate;
    }

    /**
     * @dev Enable/disable strategy
     */
    function setStrategyEnabled(string calldata strategyType, bool enabled) external onlyOwner {
        enabledStrategies[strategyType] = enabled;
    }

    /**
     * @dev Emergency withdrawal
     */
    function emergencyWithdraw(address token, uint256 amount) external onlyOwner {
        IERC20(token).transfer(owner(), amount);
    }

    /**
     * @dev Get user statistics
     */
    function getUserStats(address user) external view returns (
        UserTier tier,
        uint256 totalVolume,
        uint256 totalProfit,
        uint256 successRate,
        uint256 avgProfitPerOp
    ) {
        UserProfile memory profile = userProfiles[user];
        
        tier = profile.tier;
        totalVolume = profile.totalVolume;
        totalProfit = profile.totalProfit;
        
        uint256 totalOps = profile.successfulOperations + profile.failedOperations;
        successRate = totalOps > 0 ? (profile.successfulOperations * 100) / totalOps : 0;
        avgProfitPerOp = profile.successfulOperations > 0 ? 
            profile.totalProfit / profile.successfulOperations : 0;
    }

    /**
     * @dev Get system metrics
     */
    function getSystemMetrics() external view returns (
        uint256 totalVolume,
        uint256 totalProfit,
        uint256 totalOperations,
        uint256 avgProfitPerOp
    ) {
        avgProfitPerOp = totalOperationsExecuted > 0 ? 
            totalProfitsGenerated / totalOperationsExecuted : 0;
            
        return (
            totalVolumeProcessed,
            totalProfitsGenerated,
            totalOperationsExecuted,
            avgProfitPerOp
        );
    }

    /**
     * @dev Get contract configuration
     */
    function getConfiguration() external view returns (
        uint256 minOperationSize,
        uint256 profitThreshold,
        uint256 maxSlippage,
        uint256 feeRate,
        address feeRecipientAddr,
        bool isPaused
    ) {
        return (
            MINIMUM_OPERATION_SIZE,
            PROFIT_THRESHOLD,
            MAX_SLIPPAGE_BPS,
            platformFeeRate,
            feeRecipient,
            paused()
        );
    }

    // Admin functions for updating addresses
    function setBalancerVault(address _balancerVault) external onlyOwner {
        balancerVault = IBalancerVault(_balancerVault);
    }

    function setMoonwellComptroller(address _moonwellComptroller) external onlyOwner {
        moonwellComptroller = IMoonwellComptroller(_moonwellComptroller);
    }

    function setDexRouter(address _dexRouter) external onlyOwner {
        dexRouter = _dexRouter;
    }

    function setWeth(address _weth) external onlyOwner {
        weth = _weth;
    }

    function setFeeRecipient(address _feeRecipient) external onlyOwner {
        feeRecipient = _feeRecipient;
    }
}