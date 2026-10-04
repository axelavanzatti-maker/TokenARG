// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {ISwapAdapter} from "../payments/ISwapAdapter.sol";
import {MockUSDC} from "./MockUSDC.sol";

/**
 * @title MockSwapAdapter
 * @notice SOLO red local y testnet: "cambia" a USDC con precios fijos que define el owner y
 *         acuña el USDC de prueba. Reemplaza a Uniswap donde no hay liquidez real.
 */
contract MockSwapAdapter is ISwapAdapter, Ownable {
    using SafeERC20 for IERC20;

    struct PriceFeed {
        /// USDC (6 decimales) por 1 unidad entera del activo.
        uint256 usdcPerUnit;
        uint8 decimals;
    }

    MockUSDC public immutable usdc;
    address public paymentRouter;
    mapping(address asset => PriceFeed) public prices;

    event PriceUpdated(address indexed asset, uint256 usdcPerUnit, uint8 decimals);

    error NotPaymentRouter();
    error NoPrice(address asset);
    error SlippageExceeded(uint256 amountIn, uint256 maxAmountIn);
    error BadNativeValue();
    error RefundFailed();

    constructor(address owner_, address usdc_) Ownable(owner_) {
        usdc = MockUSDC(usdc_);
    }

    function setPrice(address asset, uint256 usdcPerUnit, uint8 decimals) external onlyOwner {
        prices[asset] = PriceFeed(usdcPerUnit, decimals);
        emit PriceUpdated(asset, usdcPerUnit, decimals);
    }

    function setPaymentRouter(address router) external onlyOwner {
        paymentRouter = router;
    }

    function quoteExactOutput(address assetIn, uint256 usdcOut) public view returns (uint256 amountIn) {
        PriceFeed memory feed = prices[assetIn];
        if (feed.usdcPerUnit == 0) revert NoPrice(assetIn);
        amountIn = Math.mulDiv(usdcOut, 10 ** feed.decimals, feed.usdcPerUnit, Math.Rounding.Ceil);
    }

    function swapExactOutput(address assetIn, uint256 usdcOut, uint256 maxAmountIn, address recipient, address refundTo)
        external
        payable
        returns (uint256 amountIn)
    {
        if (msg.sender != paymentRouter) revert NotPaymentRouter();
        amountIn = quoteExactOutput(assetIn, usdcOut);
        if (amountIn > maxAmountIn) revert SlippageExceeded(amountIn, maxAmountIn);

        uint256 leftover = maxAmountIn - amountIn;
        if (assetIn == address(0)) {
            if (msg.value != maxAmountIn) revert BadNativeValue();
            if (leftover > 0) {
                (bool ok,) = refundTo.call{value: leftover}("");
                if (!ok) revert RefundFailed();
            }
        } else {
            if (msg.value != 0) revert BadNativeValue();
            if (leftover > 0) IERC20(assetIn).safeTransfer(refundTo, leftover);
        }
        usdc.mint(recipient, usdcOut);
    }
}
