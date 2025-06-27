// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

contract MockDexRouter {
    function swapExactTokensForTokens(
        uint amountIn,
        uint amountOutMin,
        address[] calldata path,
        address to,
        uint deadline
    ) external returns (uint[] memory amounts) {
        amounts = new uint[](2); // Fixed: specify array size
        amounts[0] = amountIn;
        amounts[1] = amountOutMin + 1; // Simulate a small profit
    }
}