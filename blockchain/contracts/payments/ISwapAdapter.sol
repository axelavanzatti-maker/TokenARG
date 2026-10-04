// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * @notice Conversión de la moneda con la que paga el inversor a USDC, con salida exacta: el
 *         inversor elige cuántos dólares invierte y se cobra lo justo de la otra moneda.
 * @dev `assetIn` == address(0) representa la moneda nativa de la red (ETH en Ethereum, POL en Polygon).
 */
interface ISwapAdapter {
    /// @notice Cuánto `assetIn` hace falta para recibir exactamente `usdcOut`.
    /// @dev No es `view`: el cotizador de Uniswap simula el swap. Se llama con eth_call.
    function quoteExactOutput(address assetIn, uint256 usdcOut) external returns (uint256 amountIn);

    /**
     * @notice Cambia hasta `maxAmountIn` de `assetIn` por exactamente `usdcOut` USDC para
     *         `recipient`. Lo que sobra de `assetIn` vuelve a `refundTo`.
     * @dev El router transfiere `maxAmountIn` al adaptador antes de llamar (o lo envía como
     *      msg.value si es la moneda nativa).
     */
    function swapExactOutput(address assetIn, uint256 usdcOut, uint256 maxAmountIn, address recipient, address refundTo)
        external
        payable
        returns (uint256 amountIn);
}
