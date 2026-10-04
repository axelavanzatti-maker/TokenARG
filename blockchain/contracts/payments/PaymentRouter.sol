// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {TokenOffering} from "../TokenOffering.sol";
import {ISwapAdapter} from "./ISwapAdapter.sol";

/**
 * @title PaymentRouter
 * @notice Permite invertir pagando con la moneda nativa de la red, WBTC, WETH o USDT: convierte
 *         a USDC en la misma transacción y compra en nombre del inversor. El fideicomiso siempre
 *         recibe dólares estables.
 *
 * @dev Flujo de buyWithAsset():
 *      1. El inversor envía hasta `maxAmountIn` de la moneda elegida (approve previo si es ERC-20).
 *      2. El adaptador la cambia por exactamente `usdcAmount` USDC y devuelve lo que sobra.
 *      3. El router llama a TokenOffering.buyFor(inversor, usdcAmount).
 *      El router no guarda saldos entre transacciones: se verifica al final de cada compra.
 *      Cada TokenOffering tiene que autorizar a este router con setRouter().
 */
contract PaymentRouter is AccessControl, ReentrancyGuard {
    using SafeERC20 for IERC20;

    address public constant NATIVE = address(0);

    IERC20 public immutable usdc;
    ISwapAdapter public adapter;
    mapping(address asset => bool) public isAccepted;

    event PaidWithAsset(
        address indexed investor, address indexed offering, address indexed asset, uint256 amountIn, uint256 usdcAmount
    );
    event AdapterUpdated(address indexed adapter);
    event AssetAccepted(address indexed asset, bool accepted);

    error ZeroAddress();
    error AssetNotAccepted(address asset);
    error Expired();
    error BadNativeValue();
    error SlippageExceeded(uint256 amountIn, uint256 maxAmountIn);
    error UnexpectedBalance();

    constructor(address admin, address usdc_, address adapter_) {
        if (admin == address(0) || usdc_ == address(0) || adapter_ == address(0)) revert ZeroAddress();
        usdc = IERC20(usdc_);
        adapter = ISwapAdapter(adapter_);
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
    }

    /**
     * @notice Invierte `usdcAmount` dólares en `offering` pagando con `asset`.
     * @param maxAmountIn Máximo de `asset` dispuesto a pagar (cotización + tolerancia de precio).
     * @param deadline Vencimiento de la cotización (segundos UNIX).
     * @return tokenAmount Tokens del proyecto recibidos.
     */
    function buyWithAsset(address offering, address asset, uint256 usdcAmount, uint256 maxAmountIn, uint256 deadline)
        external
        payable
        nonReentrant
        returns (uint256 tokenAmount)
    {
        if (block.timestamp > deadline) revert Expired();
        if (!isAccepted[asset]) revert AssetNotAccepted(asset);
        if (offering == address(0)) revert ZeroAddress();

        uint256 usdcBefore = usdc.balanceOf(address(this));
        uint256 amountIn;
        if (asset == NATIVE) {
            if (msg.value != maxAmountIn) revert BadNativeValue();
            amountIn = adapter.swapExactOutput{value: maxAmountIn}(NATIVE, usdcAmount, maxAmountIn, address(this), msg.sender);
        } else {
            if (msg.value != 0) revert BadNativeValue();
            IERC20(asset).safeTransferFrom(msg.sender, address(adapter), maxAmountIn);
            amountIn = adapter.swapExactOutput(asset, usdcAmount, maxAmountIn, address(this), msg.sender);
        }
        if (amountIn > maxAmountIn) revert SlippageExceeded(amountIn, maxAmountIn);
        if (usdc.balanceOf(address(this)) < usdcBefore + usdcAmount) revert UnexpectedBalance();

        usdc.forceApprove(offering, usdcAmount);
        tokenAmount = TokenOffering(offering).buyFor(msg.sender, usdcAmount);
        usdc.forceApprove(offering, 0);
        // La oferta tomó exactamente lo convertido: el router queda como estaba.
        if (usdc.balanceOf(address(this)) != usdcBefore) revert UnexpectedBalance();

        emit PaidWithAsset(msg.sender, offering, asset, amountIn, usdcAmount);
    }

    /// @notice Cotización: cuánto `asset` hace falta para invertir `usdcAmount`. Usar con eth_call.
    function quote(address asset, uint256 usdcAmount) external returns (uint256 amountIn) {
        if (!isAccepted[asset]) revert AssetNotAccepted(asset);
        return adapter.quoteExactOutput(asset, usdcAmount);
    }

    function setAdapter(address adapter_) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (adapter_ == address(0)) revert ZeroAddress();
        adapter = ISwapAdapter(adapter_);
        emit AdapterUpdated(adapter_);
    }

    function setAccepted(address asset, bool accepted) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (asset == address(usdc)) revert AssetNotAccepted(asset); // USDC se paga directo en la oferta
        isAccepted[asset] = accepted;
        emit AssetAccepted(asset, accepted);
    }
}
