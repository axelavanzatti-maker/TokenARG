import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { network } from "hardhat";
import {
  DAY,
  OfferingState,
  assertClose,
  deploySystem,
  distribute,
  invest,
  tokens,
  usdc,
  type Connection,
} from "./fixtures.js";

describe("TokenOffering", async function () {
  const conn: Connection = await network.create();
  const { viem, networkHelpers } = conn;

  async function openOffering() {
    return deploySystem(conn);
  }

  async function upcomingOffering() {
    return deploySystem(conn, { startOffset: 7n * DAY });
  }

  async function expensiveTokenOffering() {
    // 1 token = 2,50 USDC
    return deploySystem(conn, { price: usdc("2.5") });
  }

  describe("configuración", function () {
    it("rechaza parámetros inconsistentes", async function () {
      const sys = await networkHelpers.loadFixture(openOffering);
      const base = {
        assetToken: sys.token.address,
        paymentToken: sys.usdcToken.address,
        treasury: sys.treasury.account.address,
        pricePerToken: usdc(1),
        minPurchase: usdc(100),
        softCap: usdc(5_000),
        hardCap: usdc(10_000),
        startTime: sys.now,
        endTime: sys.now + DAY,
      };
      for (const bad of [
        { softCap: usdc(20_000) }, // mínimo mayor al cupo
        { endTime: sys.now }, // termina cuando empieza
        { pricePerToken: 0n },
        { hardCap: usdc(20_000) }, // el cupo no entra en el maxSupply del token
      ]) {
        await assert.rejects(
          viem.deployContract("TokenOffering", [{ ...base, ...bad }, sys.admin.account.address]),
          /InvalidConfig/,
        );
      }
    });

    it("expone un resumen para la interfaz", async function () {
      const sys = await networkHelpers.loadFixture(openOffering);
      const [state, raised, sold, investors, price, minimum, soft, hard] = await sys.offering.read.summary();
      assert.equal(state, OfferingState.Open);
      assert.deepEqual(
        [raised, sold, investors, price, minimum, soft, hard],
        [0n, 0n, 0n, usdc(1), usdc(100), usdc(5_000), usdc(10_000)],
      );
    });
  });

  describe("compra", function () {
    it("deja el USDC en garantía y entrega los tokens en el acto", async function () {
      const sys = await networkHelpers.loadFixture(openOffering);
      await sys.usdcToken.write.approve([sys.offering.address, usdc(1_500)], { account: sys.alice.account });

      await viem.assertions.emitWithArgs(
        sys.offering.write.buy([usdc(1_500)], { account: sys.alice.account }),
        sys.offering,
        "TokensPurchased",
        [sys.alice.account.address, usdc(1_500), tokens(1_500)],
      );

      assert.equal(await sys.token.read.balanceOf([sys.alice.account.address]), tokens(1_500));
      assert.equal(await sys.usdcToken.read.balanceOf([sys.offering.address]), usdc(1_500));
      assert.equal(await sys.offering.read.contributionOf([sys.alice.account.address]), usdc(1_500));
      assert.equal(await sys.offering.read.totalRaised(), usdc(1_500));
      assert.equal(await sys.offering.read.investorCount(), 1n);

      // Una segunda compra del mismo inversor no lo cuenta dos veces.
      await invest(sys, sys.alice, usdc(500));
      assert.equal(await sys.offering.read.investorCount(), 1n);
      assert.equal(await sys.token.read.balanceOf([sys.alice.account.address]), tokens(2_000));
    });

    it("calcula tokens fraccionarios según el precio", async function () {
      const sys = await networkHelpers.loadFixture(expensiveTokenOffering);
      assert.equal(await sys.offering.read.quote([usdc(1_000)]), tokens(400));
      await invest(sys, sys.alice, usdc(1_000));
      assert.equal(await sys.token.read.balanceOf([sys.alice.account.address]), tokens(400));
    });

    it("rechaza billeteras sin KYC (el hook original no lo verificaba en la compra)", async function () {
      const sys = await networkHelpers.loadFixture(openOffering);
      await sys.usdcToken.write.approve([sys.offering.address, usdc(500)], { account: sys.mallory.account });
      await viem.assertions.revertWithCustomErrorWithArgs(
        sys.offering.write.buy([usdc(500)], { account: sys.mallory.account }),
        sys.offering,
        "InvestorNotVerified",
        [sys.mallory.account.address],
      );
    });

    it("respeta ticket mínimo y cupo; el último ticket puede ser menor si completa el cupo", async function () {
      const sys = await networkHelpers.loadFixture(openOffering);
      await sys.usdcToken.write.approve([sys.offering.address, usdc(99)], { account: sys.alice.account });
      await viem.assertions.revertWithCustomErrorWithArgs(
        sys.offering.write.buy([usdc(99)], { account: sys.alice.account }),
        sys.offering,
        "BelowMinimumPurchase",
        [usdc(100)],
      );

      await invest(sys, sys.alice, usdc(9_950));
      assert.equal(await sys.offering.read.remainingCapacity(), usdc(50));
      await sys.usdcToken.write.approve([sys.offering.address, usdc(100)], { account: sys.bob.account });
      await viem.assertions.revertWithCustomErrorWithArgs(
        sys.offering.write.buy([usdc(100)], { account: sys.bob.account }),
        sys.offering,
        "HardCapExceeded",
        [usdc(50)],
      );

      await invest(sys, sys.bob, usdc(50)); // < mínimo pero completa el cupo
      assert.equal(await sys.offering.read.state(), OfferingState.Closed);
    });

    it("no vende antes del inicio, ni después del cierre, ni en pausa", async function () {
      const sys = await networkHelpers.loadFixture(upcomingOffering);
      await sys.usdcToken.write.approve([sys.offering.address, usdc(10_000)], { account: sys.alice.account });
      await viem.assertions.revertWithCustomErrorWithArgs(
        sys.offering.write.buy([usdc(100)], { account: sys.alice.account }),
        sys.offering,
        "OfferingNotOpen",
        [OfferingState.Upcoming],
      );

      await networkHelpers.time.increaseTo(await sys.offering.read.startTime());
      await sys.offering.write.pause({ account: sys.admin.account });
      await viem.assertions.revertWithCustomError(
        sys.offering.write.buy([usdc(100)], { account: sys.alice.account }),
        sys.offering,
        "EnforcedPause",
      );
      await sys.offering.write.unpause({ account: sys.admin.account });
      await sys.offering.write.buy([usdc(100)], { account: sys.alice.account });

      await networkHelpers.time.increaseTo(await sys.offering.read.endTime());
      await viem.assertions.revertWithCustomErrorWithArgs(
        sys.offering.write.buy([usdc(100)], { account: sys.alice.account }),
        sys.offering,
        "OfferingNotOpen",
        [OfferingState.Closed],
      );
    });
  });

  describe("cierre exitoso", function () {
    it("solo se finaliza vencido el plazo y transfiere los fondos a la tesorería", async function () {
      const sys = await networkHelpers.loadFixture(openOffering);
      await invest(sys, sys.alice, usdc(4_000));
      await invest(sys, sys.bob, usdc(2_000));

      await viem.assertions.revertWithCustomErrorWithArgs(
        sys.offering.write.finalize(),
        sys.offering,
        "CannotFinalize",
        [OfferingState.Open],
      );

      await networkHelpers.time.increaseTo(await sys.offering.read.endTime());
      await viem.assertions.emitWithArgs(
        sys.offering.write.finalize({ account: sys.carol.account }), // cualquiera puede cerrar
        sys.offering,
        "OfferingFinalized",
        [true, usdc(6_000)],
      );

      assert.equal(await sys.offering.read.state(), OfferingState.Successful);
      assert.equal(await sys.usdcToken.read.balanceOf([sys.treasury.account.address]), usdc(6_000));
      assert.equal(await sys.usdcToken.read.balanceOf([sys.offering.address]), 0n);
      await viem.assertions.revertWithCustomError(
        sys.offering.write.refund({ account: sys.alice.account }),
        sys.offering,
        "RefundsNotAvailable",
      );
      await viem.assertions.revertWithCustomError(
        sys.offering.write.cancel({ account: sys.admin.account }),
        sys.offering,
        "AlreadyFinalized",
      );
    });

    it("con el cupo completo se puede cerrar sin esperar el plazo", async function () {
      const sys = await networkHelpers.loadFixture(openOffering);
      await invest(sys, sys.alice, usdc(10_000));
      await sys.offering.write.finalize();
      assert.equal(await sys.offering.read.state(), OfferingState.Successful);
    });
  });

  describe("ronda fallida o cancelada", function () {
    it("sin alcanzar el mínimo: reembolso completo y quema de tokens", async function () {
      const sys = await networkHelpers.loadFixture(openOffering);
      await invest(sys, sys.alice, usdc(1_000));
      await invest(sys, sys.bob, usdc(500));
      await networkHelpers.time.increaseTo(await sys.offering.read.endTime());

      await viem.assertions.emitWithArgs(sys.offering.write.finalize(), sys.offering, "OfferingFinalized", [
        false,
        usdc(1_500),
      ]);
      assert.equal(await sys.offering.read.state(), OfferingState.Failed);

      const before = await sys.usdcToken.read.balanceOf([sys.alice.account.address]);
      await viem.assertions.emitWithArgs(
        sys.offering.write.refund({ account: sys.alice.account }),
        sys.offering,
        "Refunded",
        [sys.alice.account.address, usdc(1_000), tokens(1_000)],
      );
      assert.equal(await sys.usdcToken.read.balanceOf([sys.alice.account.address]), before + usdc(1_000));
      assert.equal(await sys.token.read.balanceOf([sys.alice.account.address]), 0n);
      assert.equal(await sys.offering.read.totalRefunded(), usdc(1_000));

      await viem.assertions.revertWithCustomError(
        sys.offering.write.refund({ account: sys.alice.account }),
        sys.offering,
        "NothingToRefund",
      );
    });

    it("el reembolso funciona aunque al inversor le hayan dado de baja el KYC", async function () {
      const sys = await networkHelpers.loadFixture(openOffering);
      await invest(sys, sys.alice, usdc(1_000));
      await sys.offering.write.cancel({ account: sys.admin.account });
      await sys.registry.write.removeInvestor([sys.alice.account.address], { account: sys.agent.account });

      await sys.offering.write.refund({ account: sys.alice.account });
      assert.equal(await sys.offering.read.contributionOf([sys.alice.account.address]), 0n);
    });

    it("solo el fiduciario puede cancelar", async function () {
      const sys = await networkHelpers.loadFixture(openOffering);
      await viem.assertions.revertWithCustomError(
        sys.offering.write.cancel({ account: sys.alice.account }),
        sys.offering,
        "OwnableUnauthorizedAccount",
      );
      await viem.assertions.emitWithArgs(
        sys.offering.write.cancel({ account: sys.admin.account }),
        sys.offering,
        "OfferingCancelled",
        [0n],
      );
      assert.equal(await sys.offering.read.state(), OfferingState.Failed);
    });
  });

  describe("ciclo de vida completo", function () {
    it("KYC → compra → cierre → mercado secundario → rentas", async function () {
      const sys = await networkHelpers.loadFixture(openOffering);
      await invest(sys, sys.alice, usdc(6_000));
      await invest(sys, sys.bob, usdc(4_000));
      await sys.offering.write.finalize();

      // El fiduciario habilita el secundario y Bob le vende la mitad a Carol.
      await sys.token.write.setTransfersEnabled([true], { account: sys.admin.account });
      await sys.token.write.transfer([sys.carol.account.address, tokens(2_000)], { account: sys.bob.account });

      // Primera renta trimestral: 300 USDC.
      await distribute(sys, usdc(300));
      assertClose(await sys.token.read.withdrawableDistributionOf([sys.alice.account.address]), usdc(180));
      assertClose(await sys.token.read.withdrawableDistributionOf([sys.bob.account.address]), usdc(60));
      assertClose(await sys.token.read.withdrawableDistributionOf([sys.carol.account.address]), usdc(60));

      for (const holder of [sys.alice, sys.bob, sys.carol]) {
        await sys.token.write.claimDistributions({ account: holder.account });
      }
      // Lo que queda en el contrato es solo polvo de redondeo.
      assert.ok((await sys.usdcToken.read.balanceOf([sys.token.address])) <= 3n);
    });
  });
});
