// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

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

contract FlashLoanExecutor {
    uint256 private constant _NOT_ENTERED = 1;
    uint256 private constant _ENTERED = 2;
    uint256 private _status;
    bool private _paused;
    address private _owner;

    IBalancerVault public balancerVault;
    IMoonwellComptroller public moonwellComptroller;
    address public dexRouter;
    address public weth;
    address public feeRecipient;

    uint256 public constant MINIMUM_OPERATION_SIZE = 100_000e6;
    uint256 public constant PROFIT_THRESHOLD = 5_000e6;
    uint256 public constant MAX_SLIPPAGE_BPS = 300;
    uint256 public platformFeeRate = 50;

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

    mapping(address => UserProfile) public userProfiles;
    mapping(string => bool) public enabledStrategies;
    mapping(address => bool) public operators;

    uint256 public totalVolumeProcessed;
    uint256 public totalProfitsGenerated;
    uint256 public totalOperationsExecuted;

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

    event ExecutionFeedback(
        address indexed user,
        string strategyType,
        address indexed token,
        uint256 grossProfit,
        uint256 netProfit,
        uint256 gasUsed
    );

    event UserAuthorized(address indexed user, UserTier tier);
    event OperatorAdded(address indexed operator);
    event ProfitGenerated(address indexed user, uint256 profit);
    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);
    event Paused(address account);
    event Unpaused(address account);

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
            "Not authorized"
        );
        _;
    }

    modifier validOperationSize(uint256 amount) {
        require(amount >= MINIMUM_OPERATION_SIZE, "Below minimum size");
        _;
    }

    constructor(
        address _balancerVault,
        address _moonwellComptroller,
        address _dexRouter,
        address _weth,
        address _feeRecipient
    ) {
        _status = _NOT_ENTERED;
        _paused = false;
        _owner = msg.sender;
        emit OwnershipTransferred(address(0), msg.sender);

        balancerVault = IBalancerVault(_balancerVault);
        moonwellComptroller = IMoonwellComptroller(_moonwellComptroller);
        dexRouter = _dexRouter;
        weth = _weth;
        feeRecipient = _feeRecipient;

        operators[msg.sender] = true;
        enabledStrategies["liquidation"] = true;
        enabledStrategies["arbitrage"] = true;

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

    function executeEnterpriseOperation(
        string memory strategyType,
        address[] memory tokens,
        uint256[] memory amounts,
        bytes memory operationData
    ) external nonReentrant whenNotPaused onlyAuthorizedUser validOperationSize(amounts[0]) {
        require(enabledStrategies[strategyType], "Strategy disabled");
        require(tokens.length == amounts.length && tokens.length > 0, "Array mismatch");
        bytes memory userData = abi.encode(msg.sender, strategyType, operationData);
        balancerVault.flashLoan(address(this), tokens, amounts, userData);
    }

    function receiveFlashLoan(
        address[] memory tokens,
        uint256[] memory amounts,
        uint256[] memory feeAmounts,
        bytes memory userData
    ) external nonReentrant {
        require(msg.sender == address(balancerVault), "Only Balancer");

        uint256 gasStart = gasleft();

        FlashLoanData memory data;
        data.token = tokens[0];
        data.amount = amounts[0];
        data.totalRepayment = amounts[0] + feeAmounts[0];

        (data.user, data.strategyType, userData) = abi.decode(userData, (address, string, bytes));
        data.finalBalance = _executeStrategy(data.token, data.amount, data.strategyType, userData);
        require(data.finalBalance >= data.totalRepayment, "Repayment fail");

        data.grossProfit = data.finalBalance - data.totalRepayment;
        require(data.grossProfit >= PROFIT_THRESHOLD, "Low profit");

        _processFlashLoanComplete(data);

        uint256 gasUsed = gasStart - gasleft();
        emit ExecutionFeedback(data.user, data.strategyType, data.token, data.grossProfit, data.netProfit, gasUsed);
    }

    function _executeStrategy(address token, uint256 amount, string memory strategyType, bytes memory operationData)
        internal returns (uint256 finalBalance) {
        if (keccak256(bytes(strategyType)) == keccak256("liquidation")) {
            finalBalance = _executeLiquidation(token, amount, operationData);
        } else if (keccak256(bytes(strategyType)) == keccak256("arbitrage")) {
            finalBalance = _executeArbitrage(token, amount, operationData);
        } else {
            revert("Unknown strategy");
        }
    }

    function _processFlashLoanComplete(FlashLoanData memory data) internal {
        data.fees = _calculateFees(data.user, data.grossProfit);
        data.netProfit = data.grossProfit - data.fees;

        IERC20(data.token).approve(address(balancerVault), data.totalRepayment);
        IERC20(data.token).transfer(address(balancerVault), data.totalRepayment);

        if (data.fees > 0) IERC20(data.token).transfer(feeRecipient, data.fees);
        IERC20(data.token).transfer(data.user, data.netProfit);

        _updateUserMetrics(data.user, data.amount, data.netProfit, true);

        emit FlashLoanExecuted(data.user, data.strategyType, data.token, data.amount, data.grossProfit, data.netProfit, data.fees, true);
        emit ProfitGenerated(data.user, data.netProfit);
    }

    function _executeLiquidation(address token, uint256, bytes memory operationData) internal returns (uint256) {
        (address borrower, address mTokenBorrowed, address mTokenCollateral, uint256 repayAmount) =
            abi.decode(operationData, (address, address, address, uint256));

        address repayToken = IMToken(mTokenBorrowed).underlying();
        address collateralToken = IMToken(mTokenCollateral).underlying();

        IERC20(repayToken).approve(mTokenBorrowed, repayAmount);
        uint256 before = IERC20(collateralToken).balanceOf(address(this));

        require(IMToken(mTokenBorrowed).liquidateBorrow(borrower, repayAmount, mTokenCollateral) == 0, "Liquidation fail");

        uint256 mBal = IERC20(mTokenCollateral).balanceOf(address(this));
        if (mBal > 0) IMToken(mTokenCollateral).redeem(mBal);

        uint256 afterBal = IERC20(collateralToken).balanceOf(address(this));
        uint256 seized = afterBal - before;

        return token == collateralToken ? seized : _swapTokens(collateralToken, token, seized);
    }

    function _executeArbitrage(address token, uint256, bytes memory) internal view returns (uint256) {
        return IERC20(token).balanceOf(address(this));
    }

    function _swapTokens(address tokenIn, address, uint256 amountIn) internal returns (uint256) {
        IERC20(tokenIn).approve(dexRouter, amountIn);
        return amountIn;
    }

    function _calculateFees(address user, uint256 grossProfit) internal view returns (uint256) {
        uint256 rate = platformFeeRate;
        UserTier tier = userProfiles[user].tier;
        if (tier == UserTier.WHALE) rate = rate * 50 / 100;
        else if (tier == UserTier.INSTITUTIONAL) rate = rate * 70 / 100;
        else if (tier == UserTier.PREMIUM) rate = rate * 90 / 100;
        return grossProfit * rate / 10000;
    }

    function _updateUserMetrics(address user, uint256 volume, uint256 profit, bool success) internal {
        UserProfile storage profile = userProfiles[user];
        profile.totalVolume += volume;
        profile.totalProfit += profit;
        profile.lastOperationTime = block.timestamp;
        if (success) profile.successfulOperations++;
        else profile.failedOperations++;

        totalVolumeProcessed += volume;
        totalProfitsGenerated += profit;
        totalOperationsExecuted++;
    }

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

    function addOperator(address operator) external onlyOwner {
        operators[operator] = true;
        emit OperatorAdded(operator);
    }

    function transferOwnership(address newOwner) public onlyOwner {
        require(newOwner != address(0), "Invalid owner");
        emit OwnershipTransferred(_owner, newOwner);
        _owner = newOwner;
    }

    function emergencyPause() external onlyOwner {
        _paused = true;
        emit Paused(msg.sender);
    }

    function unpause() external onlyOwner {
        _paused = false;
        emit Unpaused(msg.sender);
    }

    function setPlatformFeeRate(uint256 newFeeRate) external onlyOwner {
        require(newFeeRate <= 1000, "Fee too high");
        platformFeeRate = newFeeRate;
    }

    function setStrategyEnabled(string calldata strategyType, bool enabled) external onlyOwner {
        enabledStrategies[strategyType] = enabled;
    }

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

    function emergencyWithdraw(address token, uint256 amount) external onlyOwner {
        IERC20(token).transfer(_owner, amount);
    }
}
