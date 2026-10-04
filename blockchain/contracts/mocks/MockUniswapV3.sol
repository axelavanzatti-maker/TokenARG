// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {IUniswapV3SwapRouter, IUniswapV3QuoterV2} from "../payments/UniswapV3Adapter.sol";
import {MockUSDC} from "./MockUSDC.sol";

/**
 * @notice SOLO tests: imita la interfaz de SwapRouter02 y QuoterV2 de Uniswap con un precio fijo
 *         por token, para verificar el cableado de UniswapV3Adapter sin una red real.
 */
contract MockUniswapV3 is IUniswapV3SwapRouter, IUniswapV3QuoterV2 {
    MockUSDC public immutable usdc;
    mapping(address token => uint256 usdcPerUnit) public price;
    mapping(address token => uint8 decimals) public decimalsOf;
    uint24 public lastFee;

    constructor(address usdc_) {
        usdc = MockUSDC(usdc_);
    }

    function setPrice(address token, uint256 usdcPerUnit, uint8 decimals_) external {
        price[token] = usdcPerUnit;
        decimalsOf[token] = decimals_;
    }

    function _amountIn(address tokenIn, uint256 amountOut) private view returns (uint256) {
        return Math.mulDiv(amountOut, 10 ** decimalsOf[tokenIn], price[tokenIn], Math.Rounding.Ceil);
    }

    function exactOutputSingle(ExactOutputSingleParams calldata p) external payable returns (uint256 amountIn) {
        require(p.tokenOut == address(usdc), "solo USDC");
        amountIn = _amountIn(p.tokenIn, p.amountOut);
        require(amountIn <= p.amountInMaximum, "Too much requested");
        lastFee = p.fee;
        IERC20(p.tokenIn).transferFrom(msg.sender, address(this), amountIn);
        usdc.mint(p.recipient, p.amountOut);
    }

    function quoteExactOutputSingle(QuoteExactOutputSingleParams memory p)
        external
        view
        returns (uint256 amountIn, uint160, uint32, uint256)
    {
        return (_amountIn(p.tokenIn, p.amount), 0, 0, 0);
    }
}

/// @notice SOLO tests: moneda nativa envuelta (WETH9 / WPOL) mínima.
contract MockWrappedNative is ERC20 {
    constructor() ERC20("Wrapped Native (Test)", "WNATIVE") {}

    function deposit() external payable {
        _mint(msg.sender, msg.value);
    }

    function withdraw(uint256 amount) external {
        _burn(msg.sender, amount);
        (bool ok,) = msg.sender.call{value: amount}("");
        require(ok, "withdraw");
    }
}
