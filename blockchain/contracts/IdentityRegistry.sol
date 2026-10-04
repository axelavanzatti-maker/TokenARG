// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {IIdentityRegistry} from "./interfaces/IIdentityRegistry.sol";

/**
 * @title IdentityRegistry
 * @notice Lista blanca de billeteras que completaron KYC/AML en TokenARG.
 * @dev No se guarda ningún dato personal on-chain: solo la billetera y el vencimiento
 *      de su verificación (el legajo vive en el proveedor KYC y en la base de datos).
 *
 *      Roles:
 *      - DEFAULT_ADMIN_ROLE: fiduciario (en producción, una multisig). Otorga y revoca agentes.
 *      - AGENT_ROLE: backend que procesa el resultado del proveedor KYC. Es una hot wallet,
 *        por eso no tiene ningún permiso sobre los tokens ni sobre los fondos.
 */
contract IdentityRegistry is IIdentityRegistry, AccessControl {
    bytes32 public constant AGENT_ROLE = keccak256("AGENT_ROLE");

    /// @dev 0 = no registrado. Si no, timestamp (segundos) hasta el que la verificación es válida.
    mapping(address investor => uint64 validUntil) private _validUntil;

    event InvestorRegistered(address indexed investor, uint64 validUntil, address indexed agent);
    event InvestorRemoved(address indexed investor, address indexed agent);

    error ZeroAddress();
    error InvalidExpiry(uint64 validUntil);
    error LengthMismatch();

    constructor(address admin) {
        if (admin == address(0)) revert ZeroAddress();
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
    }

    /// @notice Alta o renovación de un inversor verificado.
    /// @param validUntil Vencimiento de la verificación (el legajo KYC debe actualizarse periódicamente).
    function registerInvestor(address investor, uint64 validUntil) external onlyRole(AGENT_ROLE) {
        _register(investor, validUntil);
    }

    function batchRegisterInvestors(address[] calldata investors, uint64[] calldata validUntil)
        external
        onlyRole(AGENT_ROLE)
    {
        if (investors.length != validUntil.length) revert LengthMismatch();
        for (uint256 i; i < investors.length; ++i) {
            _register(investors[i], validUntil[i]);
        }
    }

    /// @notice Baja inmediata (KYC rechazado, alerta AML, pedido del titular).
    /// @dev Una billetera dada de baja no puede recibir ni transferir tokens ni cobrar distribuciones.
    function removeInvestor(address investor) external onlyRole(AGENT_ROLE) {
        delete _validUntil[investor];
        emit InvestorRemoved(investor, msg.sender);
    }

    /// @inheritdoc IIdentityRegistry
    function isVerified(address investor) external view returns (bool) {
        return _validUntil[investor] >= block.timestamp;
    }

    /// @notice Vencimiento de la verificación (0 si nunca fue registrada o fue dada de baja).
    function verificationExpiry(address investor) external view returns (uint64) {
        return _validUntil[investor];
    }

    function _register(address investor, uint64 validUntil) private {
        if (investor == address(0)) revert ZeroAddress();
        if (validUntil <= block.timestamp) revert InvalidExpiry(validUntil);
        _validUntil[investor] = validUntil;
        emit InvestorRegistered(investor, validUntil, msg.sender);
    }
}
