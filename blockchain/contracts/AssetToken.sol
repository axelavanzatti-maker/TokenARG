// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {SafeCast} from "@openzeppelin/contracts/utils/math/SafeCast.sol";
import {IIdentityRegistry} from "./interfaces/IIdentityRegistry.sol";

/**
 * @title AssetToken
 * @notice Cuotapartes tokenizadas de un fideicomiso o activo real listado en TokenARG.
 *
 * @dev Reglas de cumplimiento, aplicadas en cada movimiento de saldo (_update):
 *      - Solo billeteras con KYC vigente pueden recibir tokens, incluida la emisión (mint).
 *      - Una transferencia entre inversores exige KYC vigente en origen y destino, y que el
 *        fiduciario haya habilitado el mercado secundario (transfersEnabled, apagado por defecto).
 *      - Nada se mueve mientras el contrato está pausado (salvo recoverWallet, ver abajo).
 *
 *      Distribuciones (rentas, intereses, liquidación final) en la stablecoin de pago,
 *      prorrateadas según la tenencia en el momento de cada distribución. Se usa el patrón
 *      "magnified dividend per share": cada distribución cuesta O(1) gas sin importar la
 *      cantidad de tenedores, y transferir tokens no altera lo que cada tenedor ya devengó.
 *
 *      El documento legal (contrato de fideicomiso / prospecto) queda anclado por su hash
 *      SHA-256: la URI puede cambiar de servidor, pero el hash fija la versión exacta.
 */
contract AssetToken is ERC20, AccessControl, Pausable, ReentrancyGuard {
    using SafeERC20 for IERC20;
    using SafeCast for uint256;
    using SafeCast for int256;

    bytes32 public constant MINTER_ROLE = keccak256("MINTER_ROLE");
    bytes32 public constant PAUSER_ROLE = keccak256("PAUSER_ROLE");
    bytes32 public constant DISTRIBUTOR_ROLE = keccak256("DISTRIBUTOR_ROLE");

    uint256 private constant MAGNITUDE = 2 ** 128;

    /// @dev Supply mínimo (1 token entero) para distribuir. Con un supply ínfimo el "dividendo
    ///      por unidad" se dispara y emisiones posteriores grandes desbordarían la contabilidad.
    uint256 public constant MIN_DISTRIBUTION_SUPPLY = 1e18;

    struct InitParams {
        string name;
        string symbol;
        /// Tope de emisión en unidades mínimas (18 decimales).
        uint256 maxSupply;
        /// Fiduciario: recibe DEFAULT_ADMIN_ROLE, PAUSER_ROLE y DISTRIBUTOR_ROLE.
        address admin;
        address identityRegistry;
        /// Stablecoin en la que se pagan las distribuciones (USDC).
        address distributionToken;
        /// Valuación del activo subyacente en USD, sin decimales.
        uint256 assetValuationUSD;
        /// Rendimiento anual estimado en puntos básicos (1250 = 12,50 %).
        uint256 expectedYieldBps;
        string legalDocumentURI;
        /// SHA-256 del PDF del contrato fiduciario.
        bytes32 legalDocumentHash;
    }

    uint256 public immutable maxSupply;
    IERC20 public immutable distributionToken;

    IIdentityRegistry public identityRegistry;
    bool public transfersEnabled;

    uint256 public assetValuationUSD;
    uint256 public expectedYieldBps;
    string public legalDocumentURI;
    bytes32 public legalDocumentHash;

    uint256 public totalDistributed;
    uint256 private _magnifiedPerShare;
    mapping(address holder => int256) private _magnifiedCorrections;
    mapping(address holder => uint256) private _withdrawnDistributions;

    event IdentityRegistryUpdated(address indexed newRegistry);
    event TransfersEnabledUpdated(bool enabled);
    event AssetInfoUpdated(uint256 assetValuationUSD, uint256 expectedYieldBps);
    event LegalDocumentUpdated(string uri, bytes32 documentHash);
    event DistributionDeposited(address indexed distributor, uint256 amount);
    event DistributionClaimed(address indexed holder, uint256 amount);
    event WalletRecovered(
        address indexed lostWallet, address indexed newWallet, uint256 tokens, uint256 pendingDistributions
    );

    error InvestorNotVerified(address investor);
    error MaxSupplyExceeded(uint256 requested, uint256 available);
    error TransfersDisabled();
    error ZeroAddress();
    error ZeroAmount();
    error SupplyTooLow(uint256 supply, uint256 minimum);
    error NothingToClaim();
    error InvalidRecovery();

    constructor(InitParams memory p) ERC20(p.name, p.symbol) {
        if (p.admin == address(0) || p.identityRegistry == address(0) || p.distributionToken == address(0)) {
            revert ZeroAddress();
        }
        if (p.maxSupply == 0) revert ZeroAmount();

        maxSupply = p.maxSupply;
        distributionToken = IERC20(p.distributionToken);
        identityRegistry = IIdentityRegistry(p.identityRegistry);
        assetValuationUSD = p.assetValuationUSD;
        expectedYieldBps = p.expectedYieldBps;
        legalDocumentURI = p.legalDocumentURI;
        legalDocumentHash = p.legalDocumentHash;

        _grantRole(DEFAULT_ADMIN_ROLE, p.admin);
        _grantRole(PAUSER_ROLE, p.admin);
        _grantRole(DISTRIBUTOR_ROLE, p.admin);
    }

    // ---------------------------------------------------------------------
    // Emisión (la ejecuta el contrato de oferta primaria, que tiene MINTER_ROLE)
    // ---------------------------------------------------------------------

    function mint(address to, uint256 amount) external onlyRole(MINTER_ROLE) {
        uint256 available = maxSupply - totalSupply();
        if (amount > available) revert MaxSupplyExceeded(amount, available);
        _mint(to, amount);
    }

    /// @notice Quema tokens de un inversor. Lo usa la oferta primaria para los reembolsos.
    function burn(address from, uint256 amount) external onlyRole(MINTER_ROLE) {
        _burn(from, amount);
    }

    // ---------------------------------------------------------------------
    // Distribuciones
    // ---------------------------------------------------------------------

    /**
     * @notice Deposita fondos para repartir entre todos los tenedores actuales, a prorrata.
     * @dev Requiere approve previo de `amount` sobre distributionToken.
     */
    function distribute(uint256 amount) external onlyRole(DISTRIBUTOR_ROLE) nonReentrant whenNotPaused {
        uint256 supply = totalSupply();
        if (supply < MIN_DISTRIBUTION_SUPPLY) revert SupplyTooLow(supply, MIN_DISTRIBUTION_SUPPLY);

        uint256 balanceBefore = distributionToken.balanceOf(address(this));
        distributionToken.safeTransferFrom(msg.sender, address(this), amount);
        uint256 received = distributionToken.balanceOf(address(this)) - balanceBefore;
        if (received == 0) revert ZeroAmount();

        _magnifiedPerShare += (received * MAGNITUDE) / supply;
        totalDistributed += received;
        emit DistributionDeposited(msg.sender, received);
    }

    /// @notice Cobra las distribuciones pendientes de quien llama.
    function claimDistributions() external returns (uint256) {
        return _claimDistributions(msg.sender);
    }

    /// @notice Acredita las distribuciones pendientes de `holder` en su propia billetera.
    /// @dev Sin permisos: los fondos siempre van al tenedor. Permite el pago automático en lote.
    function claimDistributionsFor(address holder) external returns (uint256) {
        return _claimDistributions(holder);
    }

    /// @notice Total devengado por `holder` desde el inicio (cobrado + pendiente).
    function accumulativeDistributionOf(address holder) public view returns (uint256) {
        int256 magnified = (_magnifiedPerShare * balanceOf(holder)).toInt256() + _magnifiedCorrections[holder];
        return magnified.toUint256() / MAGNITUDE;
    }

    /// @notice Distribuciones pendientes de cobro de `holder`.
    function withdrawableDistributionOf(address holder) public view returns (uint256) {
        return accumulativeDistributionOf(holder) - _withdrawnDistributions[holder];
    }

    function withdrawnDistributionOf(address holder) external view returns (uint256) {
        return _withdrawnDistributions[holder];
    }

    // ---------------------------------------------------------------------
    // Administración (fiduciario)
    // ---------------------------------------------------------------------

    /**
     * @notice Recupera la posición de una billetera perdida u ordenada judicialmente:
     *         mueve todos los tokens y las distribuciones pendientes a una billetera nueva.
     * @dev Ignora la pausa, el KYC de origen y el bloqueo de transferencias; exige KYC en destino.
     *      Debe estar previsto en el contrato de fideicomiso.
     */
    function recoverWallet(address lostWallet, address newWallet)
        external
        onlyRole(DEFAULT_ADMIN_ROLE)
        nonReentrant
    {
        if (newWallet == address(0)) revert ZeroAddress();
        if (lostWallet == newWallet) revert InvalidRecovery();
        if (!identityRegistry.isVerified(newWallet)) revert InvestorNotVerified(newWallet);

        uint256 tokens = balanceOf(lostWallet);
        uint256 pending = withdrawableDistributionOf(lostWallet);
        if (tokens == 0 && pending == 0) revert InvalidRecovery();

        if (tokens > 0) {
            ERC20._update(lostWallet, newWallet, tokens);
            _moveCorrections(lostWallet, newWallet, tokens);
        }
        if (pending > 0) {
            _withdrawnDistributions[lostWallet] += pending;
            _magnifiedCorrections[newWallet] += (pending * MAGNITUDE).toInt256();
        }
        emit WalletRecovered(lostWallet, newWallet, tokens, pending);
    }

    function setIdentityRegistry(address newRegistry) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (newRegistry == address(0)) revert ZeroAddress();
        identityRegistry = IIdentityRegistry(newRegistry);
        emit IdentityRegistryUpdated(newRegistry);
    }

    /// @notice Habilita o bloquea el mercado secundario (transferencias entre inversores).
    function setTransfersEnabled(bool enabled) external onlyRole(DEFAULT_ADMIN_ROLE) {
        transfersEnabled = enabled;
        emit TransfersEnabledUpdated(enabled);
    }

    function setAssetInfo(uint256 newValuationUSD, uint256 newExpectedYieldBps)
        external
        onlyRole(DEFAULT_ADMIN_ROLE)
    {
        assetValuationUSD = newValuationUSD;
        expectedYieldBps = newExpectedYieldBps;
        emit AssetInfoUpdated(newValuationUSD, newExpectedYieldBps);
    }

    function setLegalDocument(string calldata uri, bytes32 documentHash) external onlyRole(DEFAULT_ADMIN_ROLE) {
        legalDocumentURI = uri;
        legalDocumentHash = documentHash;
        emit LegalDocumentUpdated(uri, documentHash);
    }

    function pause() external onlyRole(PAUSER_ROLE) {
        _pause();
    }

    function unpause() external onlyRole(PAUSER_ROLE) {
        _unpause();
    }

    // ---------------------------------------------------------------------
    // Internos
    // ---------------------------------------------------------------------

    /// @dev Hook de OpenZeppelin v5: se ejecuta en mint, burn y transfer.
    function _update(address from, address to, uint256 value) internal override {
        _requireNotPaused();
        if (to != address(0)) {
            if (!identityRegistry.isVerified(to)) revert InvestorNotVerified(to);
            if (from != address(0)) {
                if (!transfersEnabled) revert TransfersDisabled();
                if (!identityRegistry.isVerified(from)) revert InvestorNotVerified(from);
            }
        }
        super._update(from, to, value);
        _moveCorrections(from, to, value);
    }

    /// @dev Mantiene intacto lo devengado por cada parte cuando cambian los saldos.
    function _moveCorrections(address from, address to, uint256 value) private {
        int256 magnified = (_magnifiedPerShare * value).toInt256();
        if (from != address(0)) _magnifiedCorrections[from] += magnified;
        if (to != address(0)) _magnifiedCorrections[to] -= magnified;
    }

    function _claimDistributions(address holder) private nonReentrant whenNotPaused returns (uint256 amount) {
        if (!identityRegistry.isVerified(holder)) revert InvestorNotVerified(holder);
        amount = withdrawableDistributionOf(holder);
        if (amount == 0) revert NothingToClaim();
        _withdrawnDistributions[holder] += amount;
        distributionToken.safeTransfer(holder, amount);
        emit DistributionClaimed(holder, amount);
    }
}
