// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/**
 * @title MockUSDC
 * @notice USDC de prueba (6 decimales) con canilla abierta. SOLO para redes locales y testnet:
 *         el script de deploy se niega a desplegarlo en Polygon mainnet.
 */
contract MockUSDC is ERC20 {
    uint256 public constant FAUCET_LIMIT = 1_000_000 * 1e6;

    error FaucetLimitExceeded(uint256 limit);

    constructor() ERC20("USD Coin (Test)", "USDC") {}

    function decimals() public pure override returns (uint8) {
        return 6;
    }

    function mint(address to, uint256 amount) external {
        if (amount > FAUCET_LIMIT) revert FaucetLimitExceeded(FAUCET_LIMIT);
        _mint(to, amount);
    }
}
