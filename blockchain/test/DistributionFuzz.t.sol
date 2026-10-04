// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {AssetToken} from "../contracts/AssetToken.sol";
import {IdentityRegistry} from "../contracts/IdentityRegistry.sol";
import {MockUSDC} from "../contracts/mocks/MockUSDC.sol";

/// @notice Propiedades de la matemática de distribuciones bajo entradas aleatorias.
contract DistributionFuzzTest is Test {
    AssetToken internal token;
    MockUSDC internal usdc;
    IdentityRegistry internal registry;

    address internal constant ALICE = address(0xA11CE);
    address internal constant BOB = address(0xB0B);
    address internal constant CAROL = address(0xCA201);

    function setUp() public {
        usdc = new MockUSDC();
        registry = new IdentityRegistry(address(this));
        registry.grantRole(registry.AGENT_ROLE(), address(this));
        registry.registerInvestor(ALICE, uint64(block.timestamp + 365 days));
        registry.registerInvestor(BOB, uint64(block.timestamp + 365 days));
        registry.registerInvestor(CAROL, uint64(block.timestamp + 365 days));

        token = new AssetToken(
            AssetToken.InitParams({
                name: "Fuzz",
                symbol: "FZZ",
                maxSupply: 1e30,
                admin: address(this),
                identityRegistry: address(registry),
                distributionToken: address(usdc),
                assetValuationUSD: 1,
                expectedYieldBps: 1,
                legalDocumentURI: "",
                legalDocumentHash: bytes32(0)
            })
        );
        token.grantRole(token.MINTER_ROLE(), address(this));
        token.setTransfersEnabled(true);
        usdc.approve(address(token), type(uint256).max);
    }

    function _distribute(uint256 amount) internal {
        usdc.mint(address(this), amount);
        token.distribute(amount);
    }

    function _assertWithin(uint256 actual, uint256 expected, uint256 tolerance) internal pure {
        uint256 diff = actual > expected ? actual - expected : expected - actual;
        require(diff <= tolerance, "fuera de tolerancia");
    }

    /// Cada tenedor cobra su prorrata exacta (±2 unidades) aunque haya transferencias en el medio.
    function testFuzz_ProRataAcrossTransfers(uint256 a, uint256 b, uint256 d1, uint256 d2, uint256 t) public {
        a = bound(a, 1e18, 1e27);
        b = bound(b, 1e18, 1e27);
        d1 = bound(d1, 1, 1e12);
        d2 = bound(d2, 1, 1e12);
        t = bound(t, 0, a);

        token.mint(ALICE, a);
        token.mint(BOB, b);
        _distribute(d1);

        vm.prank(ALICE);
        token.transfer(CAROL, t);
        _distribute(d2);

        uint256 supply = a + b;
        uint256 expectedAlice = Math.mulDiv(d1, a, supply) + Math.mulDiv(d2, a - t, supply);
        uint256 expectedBob = Math.mulDiv(d1, b, supply) + Math.mulDiv(d2, b, supply);
        uint256 expectedCarol = Math.mulDiv(d2, t, supply);

        _assertWithin(token.withdrawableDistributionOf(ALICE), expectedAlice, 2);
        _assertWithin(token.withdrawableDistributionOf(BOB), expectedBob, 2);
        _assertWithin(token.withdrawableDistributionOf(CAROL), expectedCarol, 2);
    }

    /// Nunca se promete más de lo depositado, y el polvo de redondeo está acotado.
    function testFuzz_NeverOverpays(uint256 a, uint256 b, uint256 d1, uint256 d2, uint256 t) public {
        // Alice entra antes de la primera distribución (supply mínimo exigido: 1 token);
        // Bob entra después, con cualquier monto hasta el tope.
        a = bound(a, 1e18, 1e27);
        b = bound(b, 1, 1e29);
        d1 = bound(d1, 1, 1e12);
        d2 = bound(d2, 1, 1e12);
        t = bound(t, 0, b);

        token.mint(ALICE, a);
        _distribute(d1);
        token.mint(BOB, b);
        vm.prank(BOB);
        token.transfer(CAROL, t);
        _distribute(d2);

        uint256 owed = token.withdrawableDistributionOf(ALICE) + token.withdrawableDistributionOf(BOB)
            + token.withdrawableDistributionOf(CAROL);
        assertLe(owed, token.totalDistributed());
        assertLe(token.totalDistributed() - owed, 3);

        // Todos cobran y el contrato puede pagar a todos.
        if (token.withdrawableDistributionOf(ALICE) > 0) token.claimDistributionsFor(ALICE);
        if (token.withdrawableDistributionOf(BOB) > 0) token.claimDistributionsFor(BOB);
        if (token.withdrawableDistributionOf(CAROL) > 0) token.claimDistributionsFor(CAROL);
        assertEq(token.withdrawableDistributionOf(ALICE), 0);
        assertLe(usdc.balanceOf(address(token)), 3);
    }

    /// Peor caso de crecimiento: muchas distribuciones con el supply mínimo y después una
    /// emisión hasta el tope. La contabilidad no debe desbordar.
    function testFuzz_NoOverflowAtExtremes(uint256 d, uint8 rounds) public {
        d = bound(d, 1, usdc.FAUCET_LIMIT());
        token.mint(ALICE, token.MIN_DISTRIBUTION_SUPPLY());
        for (uint256 i; i <= rounds; ++i) {
            _distribute(d);
        }
        token.mint(BOB, token.maxSupply() - token.totalSupply());
        uint256 half = token.balanceOf(BOB) / 2;
        vm.prank(BOB);
        token.transfer(CAROL, half);

        assertEq(token.withdrawableDistributionOf(BOB), 0);
        _assertWithin(token.withdrawableDistributionOf(ALICE), d * (uint256(rounds) + 1), 2 * (uint256(rounds) + 1));
    }

    /// Recuperar una billetera conserva el total adeudado y lo traslada completo.
    function testFuzz_RecoveryPreservesClaims(uint256 a, uint256 b, uint256 d) public {
        a = bound(a, 1e18, 1e27);
        b = bound(b, 1e18, 1e27);
        d = bound(d, 1, 1e12);

        token.mint(ALICE, a);
        token.mint(BOB, b);
        _distribute(d);

        uint256 aliceOwed = token.withdrawableDistributionOf(ALICE);
        uint256 carolBefore = token.withdrawableDistributionOf(CAROL);
        token.recoverWallet(ALICE, CAROL);

        assertEq(token.withdrawableDistributionOf(ALICE), 0);
        assertEq(token.withdrawableDistributionOf(CAROL), carolBefore + aliceOwed);
        assertEq(token.balanceOf(CAROL), a);
    }
}
