// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

contract MockBalancerVault {
    function flashLoan(
        address recipient,
        address[] memory tokens,
        uint256[] memory amounts,
        bytes memory userData
    ) external {
        // Mock behavior: immediately call the recipient’s callback
        for (uint256 i = 0; i < tokens.length; i++) {
            IERC20(tokens[i]).transfer(recipient, amounts[i]);
        }

        IFlashLoanRecipient(recipient).receiveFlashLoan(tokens, amounts, new uint256[](tokens.length), userData);
    }
}

interface IFlashLoanRecipient {
    function receiveFlashLoan(address[] calldata tokens, uint256[] calldata amounts, uint256[] calldata fees, bytes calldata userData) external;
}

interface IERC20 {
    function transfer(address to, uint256 amount) external returns (bool);
}
