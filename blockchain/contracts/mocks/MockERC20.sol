// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/**
 * @title MockERC20
 * @notice Token de prueba con canilla (WBTC, USDT, WETH de mentira). SOLO red local y testnet.
 */
contract MockERC20 is ERC20 {
    uint8 private immutable _decimals;
    uint256 public immutable faucetLimit;

    error FaucetLimitExceeded(uint256 limit);

    constructor(string memory name_, string memory symbol_, uint8 decimals_, uint256 faucetLimit_)
        ERC20(name_, symbol_)
    {
        _decimals = decimals_;
        faucetLimit = faucetLimit_;
    }

    function decimals() public view override returns (uint8) {
        return _decimals;
    }

    function mint(address to, uint256 amount) external {
        if (amount > faucetLimit) revert FaucetLimitExceeded(faucetLimit);
        _mint(to, amount);
    }
}
