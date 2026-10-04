// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ISwapAdapter} from "./ISwapAdapter.sol";

/// @dev Subconjunto de SwapRouter02 (IV3SwapRouter) de Uniswap.
interface IUniswapV3SwapRouter {
    struct ExactOutputSingleParams {
        address tokenIn;
        address tokenOut;
        uint24 fee;
        address recipient;
        uint256 amountOut;
        uint256 amountInMaximum;
        uint160 sqrtPriceLimitX96;
    }

    function exactOutputSingle(ExactOutputSingleParams calldata params) external payable returns (uint256 amountIn);
}

/// @dev Subconjunto de QuoterV2 de Uniswap.
interface IUniswapV3QuoterV2 {
    struct QuoteExactOutputSingleParams {
        address tokenIn;
        address tokenOut;
        uint256 amount;
        uint24 fee;
        uint160 sqrtPriceLimitX96;
    }

    function quoteExactOutputSingle(QuoteExactOutputSingleParams memory params)
        external
        returns (uint256 amountIn, uint160 sqrtPriceX96After, uint32 initializedTicksCrossed, uint256 gasEstimate);
}

/// @dev WETH9 / WPOL: la moneda nativa envuelta como ERC-20.
interface IWrappedNative {
    function deposit() external payable;
    function withdraw(uint256 amount) external;
}

/**
 * @title UniswapV3Adapter
 * @notice Convierte a USDC en pools de Uniswap V3 (Ethereum y Polygon), con salida exacta.
 * @dev Solo lo puede usar el PaymentRouter configurado. El fee tier de cada pool activo/USDC se
 *      configura con setPoolFee (por ejemplo 500 = 0,05 % para WETH/USDC, 100 para USDT/USDC).
 *      IMPORTANTE: antes de usarlo con dinero real, probarlo contra un fork de la red y
 *      revisar la liquidez de cada pool.
 */
contract UniswapV3Adapter is ISwapAdapter, Ownable {
    using SafeERC20 for IERC20;

    IUniswapV3SwapRouter public immutable swapRouter;
    IUniswapV3QuoterV2 public immutable quoter;
    IWrappedNative public immutable wrappedNative;
    address public immutable usdc;
    address public paymentRouter;
    mapping(address asset => uint24 fee) public poolFee;

    event PoolFeeUpdated(address indexed asset, uint24 fee);
    event PaymentRouterUpdated(address indexed paymentRouter);

    error NotPaymentRouter();
    error PoolNotConfigured(address asset);
    error BadNativeValue();
    error RefundFailed();
    error ZeroAddress();

    constructor(address owner_, address swapRouter_, address quoter_, address wrappedNative_, address usdc_)
        Ownable(owner_)
    {
        if (swapRouter_ == address(0) || quoter_ == address(0) || wrappedNative_ == address(0) || usdc_ == address(0)) {
            revert ZeroAddress();
        }
        swapRouter = IUniswapV3SwapRouter(swapRouter_);
        quoter = IUniswapV3QuoterV2(quoter_);
        wrappedNative = IWrappedNative(wrappedNative_);
        usdc = usdc_;
    }

    /// @dev Recibe la moneda nativa al desenvolver el sobrante.
    receive() external payable {}

    function quoteExactOutput(address assetIn, uint256 usdcOut) external returns (uint256 amountIn) {
        (address tokenIn, uint24 fee) = _route(assetIn);
        (amountIn,,,) = quoter.quoteExactOutputSingle(
            IUniswapV3QuoterV2.QuoteExactOutputSingleParams({
                tokenIn: tokenIn,
                tokenOut: usdc,
                amount: usdcOut,
                fee: fee,
                sqrtPriceLimitX96: 0
            })
        );
    }

    function swapExactOutput(address assetIn, uint256 usdcOut, uint256 maxAmountIn, address recipient, address refundTo)
        external
        payable
        returns (uint256 amountIn)
    {
        if (msg.sender != paymentRouter) revert NotPaymentRouter();
        (address tokenIn, uint24 fee) = _route(assetIn);

        if (assetIn == address(0)) {
            if (msg.value != maxAmountIn) revert BadNativeValue();
            wrappedNative.deposit{value: maxAmountIn}();
        } else if (msg.value != 0) {
            revert BadNativeValue();
        }

        IERC20(tokenIn).forceApprove(address(swapRouter), maxAmountIn);
        amountIn = swapRouter.exactOutputSingle(
            IUniswapV3SwapRouter.ExactOutputSingleParams({
                tokenIn: tokenIn,
                tokenOut: usdc,
                fee: fee,
                recipient: recipient,
                amountOut: usdcOut,
                amountInMaximum: maxAmountIn,
                sqrtPriceLimitX96: 0
            })
        );
        IERC20(tokenIn).forceApprove(address(swapRouter), 0);

        uint256 leftover = maxAmountIn - amountIn;
        if (leftover > 0) {
            if (assetIn == address(0)) {
                wrappedNative.withdraw(leftover);
                (bool ok,) = refundTo.call{value: leftover}("");
                if (!ok) revert RefundFailed();
            } else {
                IERC20(tokenIn).safeTransfer(refundTo, leftover);
            }
        }
    }

    function setPoolFee(address asset, uint24 fee) external onlyOwner {
        poolFee[asset] = fee;
        emit PoolFeeUpdated(asset, fee);
    }

    function setPaymentRouter(address router) external onlyOwner {
        if (router == address(0)) revert ZeroAddress();
        paymentRouter = router;
        emit PaymentRouterUpdated(router);
    }

    function _route(address assetIn) private view returns (address tokenIn, uint24 fee) {
        tokenIn = assetIn == address(0) ? address(wrappedNative) : assetIn;
        fee = poolFee[assetIn];
        if (fee == 0) revert PoolNotConfigured(assetIn);
    }
}
