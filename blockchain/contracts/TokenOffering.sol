// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {AssetToken} from "./AssetToken.sol";

/**
 * @title TokenOffering
 * @notice Colocación primaria de un AssetToken contra stablecoin (USDC), con los fondos en
 *         garantía hasta que la ronda se cierre.
 *
 * @dev Flujo:
 *      1. Un inversor con KYC vigente aprueba USDC y llama a buy(). El USDC queda en este
 *         contrato y el inversor recibe sus tokens en el mismo bloque.
 *      2. Al vencer el plazo, o al completarse el cupo, cualquiera puede llamar a finalize():
 *         - si se alcanzó el mínimo (softCap), el USDC pasa a la tesorería del fideicomiso;
 *         - si no, se habilitan los reembolsos: refund() quema los tokens y devuelve el USDC.
 *      3. El fiduciario (owner) puede cancelar la ronda antes de finalizarla, lo que también
 *         habilita los reembolsos, y puede pausar las compras.
 *
 *      Pago con otras monedas: un router autorizado (PaymentRouter) cambia ETH, WBTC o USDT
 *      por USDC y llama a buyFor() en nombre del inversor. Los tokens, el aporte y un eventual
 *      reembolso quedan siempre a nombre del inversor, nunca del router.
 *
 *      Requiere MINTER_ROLE sobre el AssetToken.
 */
contract TokenOffering is Ownable2Step, Pausable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    enum State {
        Upcoming, // todavía no empezó
        Open, // aceptando compras
        Closed, // venció el plazo o se completó el cupo; falta finalize()
        Successful, // fondos transferidos a la tesorería
        Failed // no alcanzó el mínimo o fue cancelada: reembolsos habilitados
    }

    enum Outcome {
        None,
        Successful,
        Failed
    }

    struct Config {
        address assetToken;
        address paymentToken;
        address treasury;
        /// Unidades de paymentToken por 1 token entero (1e18 unidades del AssetToken).
        uint256 pricePerToken;
        /// Ticket mínimo, en unidades de paymentToken.
        uint256 minPurchase;
        /// Monto mínimo a recaudar para que la ronda sea exitosa.
        uint256 softCap;
        /// Monto máximo a recaudar (cupo de la emisión).
        uint256 hardCap;
        uint64 startTime;
        uint64 endTime;
    }

    uint256 private constant TOKEN_UNIT = 1e18;

    AssetToken public immutable assetToken;
    IERC20 public immutable paymentToken;
    address public immutable treasury;
    uint256 public immutable pricePerToken;
    uint256 public immutable minPurchase;
    uint256 public immutable softCap;
    uint256 public immutable hardCap;
    uint64 public immutable startTime;
    uint64 public immutable endTime;

    Outcome public outcome;
    uint256 public totalRaised;
    uint256 public totalTokensSold;
    uint256 public totalRefunded;
    uint256 public investorCount;
    mapping(address investor => uint256) public contributionOf;
    mapping(address investor => uint256) public tokensPurchasedOf;
    /// Contratos autorizados a comprar en nombre de un inversor (conversión de otras monedas a USDC).
    mapping(address router => bool) public isRouter;

    event TokensPurchased(address indexed investor, uint256 paymentAmount, uint256 tokenAmount);
    event OfferingFinalized(bool indexed successful, uint256 totalRaised);
    event OfferingCancelled(uint256 totalRaised);
    event Refunded(address indexed investor, uint256 paymentAmount, uint256 tokenAmount);
    event RouterUpdated(address indexed router, bool allowed);

    error InvalidConfig();
    error ZeroAddress();
    error ZeroAmount();
    error OfferingNotOpen(State state);
    error BelowMinimumPurchase(uint256 minimum);
    error HardCapExceeded(uint256 remaining);
    error InvestorNotVerified(address investor);
    error CannotFinalize(State state);
    error AlreadyFinalized();
    error RefundsNotAvailable();
    error NothingToRefund();
    error NotRouter(address caller);

    constructor(Config memory c, address initialOwner) Ownable(initialOwner) {
        if (c.assetToken == address(0) || c.paymentToken == address(0) || c.treasury == address(0)) {
            revert ZeroAddress();
        }
        if (
            c.pricePerToken == 0 || c.hardCap == 0 || c.softCap > c.hardCap || c.minPurchase > c.hardCap
                || c.startTime >= c.endTime
        ) revert InvalidConfig();

        AssetToken token = AssetToken(c.assetToken);
        // La emisión completa del cupo tiene que entrar en el tope de supply del token.
        if (Math.mulDiv(c.hardCap, TOKEN_UNIT, c.pricePerToken) > token.maxSupply() - token.totalSupply()) {
            revert InvalidConfig();
        }

        assetToken = token;
        paymentToken = IERC20(c.paymentToken);
        treasury = c.treasury;
        pricePerToken = c.pricePerToken;
        minPurchase = c.minPurchase;
        softCap = c.softCap;
        hardCap = c.hardCap;
        startTime = c.startTime;
        endTime = c.endTime;
    }

    // ---------------------------------------------------------------------
    // Inversores
    // ---------------------------------------------------------------------

    /**
     * @notice Compra tokens pagando `paymentAmount` de paymentToken (requiere approve previo).
     * @dev Se acepta un monto menor al ticket mínimo solo si completa exactamente el cupo.
     */
    function buy(uint256 paymentAmount) external nonReentrant whenNotPaused returns (uint256 tokenAmount) {
        return _buy(msg.sender, msg.sender, paymentAmount);
    }

    /**
     * @notice Compra en nombre de `investor` con USDC que aporta el router (que lo obtuvo
     *         cambiando la moneda con la que pagó el inversor). Solo routers autorizados.
     */
    function buyFor(address investor, uint256 paymentAmount)
        external
        nonReentrant
        whenNotPaused
        returns (uint256 tokenAmount)
    {
        if (!isRouter[msg.sender]) revert NotRouter(msg.sender);
        if (investor == address(0)) revert ZeroAddress();
        return _buy(investor, msg.sender, paymentAmount);
    }

    /// @notice Devuelve el USDC aportado y quema los tokens recibidos (solo si la ronda falló).
    function refund() external nonReentrant returns (uint256 paymentAmount) {
        if (outcome != Outcome.Failed) revert RefundsNotAvailable();
        paymentAmount = contributionOf[msg.sender];
        if (paymentAmount == 0) revert NothingToRefund();

        uint256 tokenAmount = tokensPurchasedOf[msg.sender];
        contributionOf[msg.sender] = 0;
        tokensPurchasedOf[msg.sender] = 0;
        totalRefunded += paymentAmount;

        assetToken.burn(msg.sender, tokenAmount);
        paymentToken.safeTransfer(msg.sender, paymentAmount);

        emit Refunded(msg.sender, paymentAmount, tokenAmount);
    }

    // ---------------------------------------------------------------------
    // Cierre
    // ---------------------------------------------------------------------

    /// @notice Cierra la ronda. Cualquiera puede llamarla una vez vencido el plazo o completado el cupo.
    function finalize() external nonReentrant {
        State s = state();
        if (s != State.Closed) revert CannotFinalize(s);

        if (totalRaised >= softCap) {
            outcome = Outcome.Successful;
            paymentToken.safeTransfer(treasury, paymentToken.balanceOf(address(this)));
            emit OfferingFinalized(true, totalRaised);
        } else {
            outcome = Outcome.Failed;
            emit OfferingFinalized(false, totalRaised);
        }
    }

    /// @notice Cancela la ronda antes de finalizarla y habilita los reembolsos.
    function cancel() external onlyOwner {
        if (outcome != Outcome.None) revert AlreadyFinalized();
        outcome = Outcome.Failed;
        emit OfferingCancelled(totalRaised);
    }

    /// @notice Autoriza (o revoca) un router de pagos con otras monedas.
    function setRouter(address router, bool allowed) external onlyOwner {
        if (router == address(0)) revert ZeroAddress();
        isRouter[router] = allowed;
        emit RouterUpdated(router, allowed);
    }

    function pause() external onlyOwner {
        _pause();
    }

    function unpause() external onlyOwner {
        _unpause();
    }

    // ---------------------------------------------------------------------
    // Internos
    // ---------------------------------------------------------------------

    function _buy(address investor, address payer, uint256 paymentAmount) private returns (uint256 tokenAmount) {
        State s = state();
        if (s != State.Open) revert OfferingNotOpen(s);

        uint256 remaining = hardCap - totalRaised;
        if (paymentAmount > remaining) revert HardCapExceeded(remaining);
        if (paymentAmount < minPurchase && paymentAmount != remaining) revert BelowMinimumPurchase(minPurchase);
        if (!assetToken.identityRegistry().isVerified(investor)) revert InvestorNotVerified(investor);

        tokenAmount = quote(paymentAmount);
        if (tokenAmount == 0) revert ZeroAmount();

        if (contributionOf[investor] == 0) investorCount += 1;
        contributionOf[investor] += paymentAmount;
        tokensPurchasedOf[investor] += tokenAmount;
        totalRaised += paymentAmount;
        totalTokensSold += tokenAmount;

        paymentToken.safeTransferFrom(payer, address(this), paymentAmount);
        assetToken.mint(investor, tokenAmount);

        emit TokensPurchased(investor, paymentAmount, tokenAmount);
    }

    // ---------------------------------------------------------------------
    // Lectura
    // ---------------------------------------------------------------------

    function state() public view returns (State) {
        if (outcome == Outcome.Successful) return State.Successful;
        if (outcome == Outcome.Failed) return State.Failed;
        if (block.timestamp < startTime) return State.Upcoming;
        if (block.timestamp >= endTime || totalRaised == hardCap) return State.Closed;
        return State.Open;
    }

    /// @notice Tokens (18 decimales) que se reciben por `paymentAmount` de paymentToken.
    function quote(uint256 paymentAmount) public view returns (uint256) {
        return Math.mulDiv(paymentAmount, TOKEN_UNIT, pricePerToken);
    }

    function remainingCapacity() external view returns (uint256) {
        return hardCap - totalRaised;
    }

    /// @notice Todo lo que necesita la interfaz en una sola llamada.
    function summary()
        external
        view
        returns (
            State currentState,
            uint256 raised,
            uint256 tokensSold,
            uint256 investors,
            uint256 price,
            uint256 minimum,
            uint256 soft,
            uint256 hard,
            uint64 start,
            uint64 end
        )
    {
        return (
            state(),
            totalRaised,
            totalTokensSold,
            investorCount,
            pricePerToken,
            minPurchase,
            softCap,
            hardCap,
            startTime,
            endTime
        );
    }
}
