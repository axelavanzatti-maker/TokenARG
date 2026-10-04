// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @notice Interfaz mínima que consumen los tokens para validar KYC.
interface IIdentityRegistry {
    /// @return true si la billetera tiene una verificación KYC vigente.
    function isVerified(address investor) external view returns (bool);
}
