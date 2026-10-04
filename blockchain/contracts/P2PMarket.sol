// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {AssetToken} from "./AssetToken.sol";

/**
 * @title P2PMarket
 * @notice Mercado secundario entre inversores verificados, al estilo de los anuncios P2P: cada
 *         orden publica un precio fijo en USDC y cualquier inversor con KYC puede tomarla, total
 *         o parcialmente.
 *
 * @dev No custodial: publicar una orden no inmoviliza fondos. El anunciante autoriza (approve)
 *      al mercado y la liquidación es un intercambio atómico token ↔ USDC cuando alguien toma la
 *      orden. Así el mercado nunca guarda saldos y las rentas del AssetToken se siguen
 *      devengando a nombre de quien todavía tiene los tokens.
 *
 *      El AssetToken aplica sus propias reglas en cada intercambio: KYC vigente de las dos
 *      partes, transferencias habilitadas por el fiduciario (setTransfersEnabled) y pausa.
 *
 *      Comisión: un porcentaje del valor operado a cada parte (buyerFeeBps y sellerFeeBps),
 *      cobrado en USDC a la billetera de comisiones de la plataforma. Tope: 2 % por parte.
 */
contract P2PMarket is AccessControl, Pausable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    enum Side {
        Sell, // el anunciante vende tokens a cambio de USDC
        Buy // el anunciante compra tokens pagando USDC
    }

    struct Order {
        address maker;
        address token;
        Side side;
        /// USDC (unidades mínimas) por 1 token entero (1e18 unidades del AssetToken).
        uint256 price;
        uint256 amount;
        uint256 remaining;
        uint64 createdAt;
        bool active;
    }

    struct OrderView {
        uint256 id;
        address maker;
        Side side;
        uint256 price;
        uint256 amount;
        uint256 remaining;
        /// Lo que hoy se puede tomar según el saldo y la autorización del anunciante.
        uint256 fillable;
        uint64 createdAt;
    }

    uint256 private constant TOKEN_UNIT = 1e18;
    uint256 private constant BPS = 10_000;
    uint16 public constant MAX_FEE_BPS = 200;
    /// Valor mínimo de una toma parcial (1 USDC), para evitar operaciones de polvo.
    uint256 public constant MIN_FILL_VALUE = 1e6;

    IERC20 public immutable paymentToken;
    address public feeRecipient;
    uint16 public buyerFeeBps;
    uint16 public sellerFeeBps;
    uint256 public minOrderValue;
    uint256 public nextOrderId;

    mapping(address token => bool) public isListed;
    mapping(uint256 id => Order) private _orders;
    mapping(address token => uint256[]) private _activeIds;
    mapping(uint256 id => uint256) private _activePosition; // índice en _activeIds + 1

    /// Tokens comprometidos en órdenes de venta activas (para calcular cuánto autorizar).
    mapping(address maker => mapping(address token => uint256)) public sellCommitted;
    /// Valor en USDC (sin comisión) comprometido en órdenes de compra activas.
    mapping(address maker => uint256) public buyCommittedValue;

    event OrderCreated(
        uint256 indexed id, address indexed token, address indexed maker, Side side, uint256 price, uint256 amount
    );
    event OrderFilled(
        uint256 indexed id,
        address indexed token,
        address indexed buyer,
        address seller,
        uint256 price,
        uint256 amount,
        uint256 value,
        uint256 buyerFee,
        uint256 sellerFee
    );
    event OrderCancelled(uint256 indexed id, address indexed token, address indexed cancelledBy);
    event TokenListed(address indexed token, bool listed);
    event FeesUpdated(uint16 buyerFeeBps, uint16 sellerFeeBps);
    event FeeRecipientUpdated(address indexed feeRecipient);
    event MinOrderValueUpdated(uint256 minOrderValue);

    error ZeroAddress();
    error InvalidAmount();
    error FeeTooHigh(uint16 maxBps);
    error TokenNotListed(address token);
    error TransfersDisabled();
    error InvestorNotVerified(address investor);
    error OrderTooSmall(uint256 minimumValue);
    error FillTooSmall(uint256 minimumValue);
    error InsufficientBalance();
    error InsufficientAllowance();
    error OrderNotActive(uint256 id);
    error SelfTrade();
    error NotOrderMaker();

    constructor(
        address admin,
        address paymentToken_,
        address feeRecipient_,
        uint16 buyerFeeBps_,
        uint16 sellerFeeBps_,
        uint256 minOrderValue_
    ) {
        if (admin == address(0) || paymentToken_ == address(0) || feeRecipient_ == address(0)) revert ZeroAddress();
        if (buyerFeeBps_ > MAX_FEE_BPS || sellerFeeBps_ > MAX_FEE_BPS) revert FeeTooHigh(MAX_FEE_BPS);
        paymentToken = IERC20(paymentToken_);
        feeRecipient = feeRecipient_;
        buyerFeeBps = buyerFeeBps_;
        sellerFeeBps = sellerFeeBps_;
        minOrderValue = minOrderValue_;
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
    }

    // ---------------------------------------------------------------------
    // Órdenes
    // ---------------------------------------------------------------------

    /**
     * @notice Publica una orden. Venta: requiere approve del AssetToken por al menos `amount`.
     *         Compra: requiere approve de USDC por el valor más la comisión del comprador.
     */
    function createOrder(address token, Side side, uint256 amount, uint256 price)
        external
        whenNotPaused
        returns (uint256 id)
    {
        if (!isListed[token]) revert TokenNotListed(token);
        if (amount == 0 || price == 0) revert InvalidAmount();
        _requireTradable(token, msg.sender);

        uint256 value = Math.mulDiv(amount, price, TOKEN_UNIT);
        if (value == 0 || value < minOrderValue) revert OrderTooSmall(minOrderValue);

        if (side == Side.Sell) {
            uint256 committed = sellCommitted[msg.sender][token] + amount;
            if (IERC20(token).balanceOf(msg.sender) < committed) revert InsufficientBalance();
            if (IERC20(token).allowance(msg.sender, address(this)) < committed) revert InsufficientAllowance();
            sellCommitted[msg.sender][token] = committed;
        } else {
            uint256 committedValue = buyCommittedValue[msg.sender] + value;
            uint256 required = committedValue + _fee(committedValue, buyerFeeBps);
            if (paymentToken.balanceOf(msg.sender) < required) revert InsufficientBalance();
            if (paymentToken.allowance(msg.sender, address(this)) < required) revert InsufficientAllowance();
            buyCommittedValue[msg.sender] = committedValue;
        }

        id = ++nextOrderId;
        _orders[id] = Order({
            maker: msg.sender,
            token: token,
            side: side,
            price: price,
            amount: amount,
            remaining: amount,
            createdAt: uint64(block.timestamp),
            active: true
        });
        _activeIds[token].push(id);
        _activePosition[id] = _activeIds[token].length;

        emit OrderCreated(id, token, msg.sender, side, price, amount);
    }

    /**
     * @notice Toma `amount` tokens de una orden. Si la orden es de venta, quien llama compra
     *         (approve de USDC por valor + comisión); si es de compra, quien llama vende
     *         (approve del AssetToken por `amount`).
     * @return value Valor operado en USDC, antes de comisiones.
     */
    function fillOrder(uint256 id, uint256 amount) external nonReentrant whenNotPaused returns (uint256 value) {
        Order storage o = _orders[id];
        if (!o.active) revert OrderNotActive(id);
        if (amount == 0 || amount > o.remaining) revert InvalidAmount();
        if (msg.sender == o.maker) revert SelfTrade();
        _requireTradable(o.token, msg.sender);

        value = Math.mulDiv(amount, o.price, TOKEN_UNIT);
        if (value == 0 || (amount != o.remaining && value < MIN_FILL_VALUE)) revert FillTooSmall(MIN_FILL_VALUE);

        (address buyer, address seller) = o.side == Side.Sell ? (msg.sender, o.maker) : (o.maker, msg.sender);
        uint256 buyerFee = _fee(value, buyerFeeBps);
        uint256 sellerFee = _fee(value, sellerFeeBps);
        address token = o.token;
        uint256 price = o.price;

        // Efectos antes de las interacciones.
        o.remaining -= amount;
        if (o.side == Side.Sell) sellCommitted[o.maker][token] -= amount;
        else buyCommittedValue[o.maker] -= Math.min(buyCommittedValue[o.maker], value);
        if (o.remaining == 0) _deactivate(id, token);

        paymentToken.safeTransferFrom(buyer, seller, value - sellerFee);
        if (buyerFee + sellerFee > 0) paymentToken.safeTransferFrom(buyer, feeRecipient, buyerFee + sellerFee);
        IERC20(token).safeTransferFrom(seller, buyer, amount);

        emit OrderFilled(id, token, buyer, seller, price, amount, value, buyerFee, sellerFee);
    }

    /// @notice Retira una orden. La puede retirar quien la publicó o la administración.
    function cancelOrder(uint256 id) external {
        Order storage o = _orders[id];
        if (!o.active) revert OrderNotActive(id);
        if (msg.sender != o.maker && !hasRole(DEFAULT_ADMIN_ROLE, msg.sender)) revert NotOrderMaker();

        if (o.side == Side.Sell) {
            sellCommitted[o.maker][o.token] -= o.remaining;
        } else {
            uint256 value = Math.mulDiv(o.remaining, o.price, TOKEN_UNIT);
            buyCommittedValue[o.maker] -= Math.min(buyCommittedValue[o.maker], value);
        }
        o.remaining = 0;
        _deactivate(id, o.token);
        emit OrderCancelled(id, o.token, msg.sender);
    }

    // ---------------------------------------------------------------------
    // Lectura
    // ---------------------------------------------------------------------

    function getOrder(uint256 id) external view returns (Order memory) {
        return _orders[id];
    }

    /// @notice Órdenes activas de un token, con lo que hoy se puede tomar de cada una.
    function getActiveOrders(address token) external view returns (OrderView[] memory views) {
        uint256[] storage ids = _activeIds[token];
        views = new OrderView[](ids.length);
        for (uint256 i; i < ids.length; ++i) {
            Order storage o = _orders[ids[i]];
            views[i] = OrderView({
                id: ids[i],
                maker: o.maker,
                side: o.side,
                price: o.price,
                amount: o.amount,
                remaining: o.remaining,
                fillable: _fillable(o),
                createdAt: o.createdAt
            });
        }
    }

    /// @notice Costo total para el comprador (valor + comisión) de `amount` tokens a `price`.
    function quoteBuy(uint256 amount, uint256 price) external view returns (uint256 value, uint256 fee) {
        value = Math.mulDiv(amount, price, TOKEN_UNIT);
        fee = _fee(value, buyerFeeBps);
    }

    /// @notice Lo que recibe el vendedor (valor − comisión) por `amount` tokens a `price`.
    function quoteSell(uint256 amount, uint256 price) external view returns (uint256 value, uint256 fee) {
        value = Math.mulDiv(amount, price, TOKEN_UNIT);
        fee = _fee(value, sellerFeeBps);
    }

    // ---------------------------------------------------------------------
    // Administración
    // ---------------------------------------------------------------------

    function setListed(address token, bool listed) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (token == address(0)) revert ZeroAddress();
        isListed[token] = listed;
        emit TokenListed(token, listed);
    }

    function setFees(uint16 buyerBps, uint16 sellerBps) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (buyerBps > MAX_FEE_BPS || sellerBps > MAX_FEE_BPS) revert FeeTooHigh(MAX_FEE_BPS);
        buyerFeeBps = buyerBps;
        sellerFeeBps = sellerBps;
        emit FeesUpdated(buyerBps, sellerBps);
    }

    function setFeeRecipient(address recipient) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (recipient == address(0)) revert ZeroAddress();
        feeRecipient = recipient;
        emit FeeRecipientUpdated(recipient);
    }

    function setMinOrderValue(uint256 value) external onlyRole(DEFAULT_ADMIN_ROLE) {
        minOrderValue = value;
        emit MinOrderValueUpdated(value);
    }

    function pause() external onlyRole(DEFAULT_ADMIN_ROLE) {
        _pause();
    }

    function unpause() external onlyRole(DEFAULT_ADMIN_ROLE) {
        _unpause();
    }

    // ---------------------------------------------------------------------
    // Internos
    // ---------------------------------------------------------------------

    /// @dev Errores claros antes de que el AssetToken revierta por su cuenta.
    function _requireTradable(address token, address account) private view {
        AssetToken asset = AssetToken(token);
        if (!asset.transfersEnabled()) revert TransfersDisabled();
        if (!asset.identityRegistry().isVerified(account)) revert InvestorNotVerified(account);
    }

    function _fee(uint256 value, uint16 bps) private pure returns (uint256) {
        return (value * bps) / BPS;
    }

    function _fillable(Order storage o) private view returns (uint256) {
        if (o.side == Side.Sell) {
            IERC20 token = IERC20(o.token);
            return Math.min(o.remaining, Math.min(token.balanceOf(o.maker), token.allowance(o.maker, address(this))));
        }
        uint256 budget = Math.min(paymentToken.balanceOf(o.maker), paymentToken.allowance(o.maker, address(this)));
        // budget = valor * (1 + fee): se descuenta la comisión del comprador.
        uint256 spendable = Math.mulDiv(budget, BPS, BPS + buyerFeeBps);
        return Math.min(o.remaining, Math.mulDiv(spendable, TOKEN_UNIT, o.price));
    }

    function _deactivate(uint256 id, address token) private {
        _orders[id].active = false;
        uint256 position = _activePosition[id];
        if (position == 0) return;
        uint256[] storage ids = _activeIds[token];
        uint256 lastId = ids[ids.length - 1];
        ids[position - 1] = lastId;
        _activePosition[lastId] = position;
        ids.pop();
        delete _activePosition[id];
    }
}
