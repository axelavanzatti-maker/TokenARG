import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { network } from "hardhat";
import { keccak256, stringToHex } from "viem";
import {
  assertClose,
  deploySystem,
  distribute,
  tokens,
  usdc,
  type Connection,
  type System,
} from "./fixtures.js";

describe("AssetToken", async function () {
  const conn: Connection = await network.create();
  const { viem, networkHelpers } = conn;

  /** Sistema con el fiduciario como minter directo (sin pasar por la oferta). */
  async function tokenFixture() {
    const sys = await deploySystem(conn);
    await sys.token.write.grantRole([await sys.token.read.MINTER_ROLE(), sys.admin.account.address]);
    return sys;
  }

  async function mint(sys: System, to: `0x${string}`, amount: bigint) {
    await sys.token.write.mint([to, amount], { account: sys.admin.account });
  }

  describe("emisión", function () {
    it("solo MINTER_ROLE puede emitir", async function () {
      const { token, alice } = await networkHelpers.loadFixture(tokenFixture);
      await viem.assertions.revertWithCustomError(
        token.write.mint([alice.account.address, tokens(1)], { account: alice.account }),
        token,
        "AccessControlUnauthorizedAccount",
      );
    });

    it("no emite a billeteras sin KYC (el documento original lo permitía)", async function () {
      const sys = await networkHelpers.loadFixture(tokenFixture);
      await viem.assertions.revertWithCustomErrorWithArgs(
        sys.token.write.mint([sys.mallory.account.address, tokens(1)], { account: sys.admin.account }),
        sys.token,
        "InvestorNotVerified",
        [sys.mallory.account.address],
      );
    });

    it("respeta el tope de supply", async function () {
      const sys = await networkHelpers.loadFixture(tokenFixture);
      const max = await sys.token.read.maxSupply();
      await mint(sys, sys.alice.account.address, max - tokens(1));
      await viem.assertions.revertWithCustomErrorWithArgs(
        sys.token.write.mint([sys.bob.account.address, tokens(2)], { account: sys.admin.account }),
        sys.token,
        "MaxSupplyExceeded",
        [tokens(2), tokens(1)],
      );
      await mint(sys, sys.bob.account.address, tokens(1));
      assert.equal(await sys.token.read.totalSupply(), max);
    });
  });

  describe("transferencias", function () {
    it("bloqueadas hasta que el fiduciario habilite el mercado secundario", async function () {
      const sys = await networkHelpers.loadFixture(tokenFixture);
      await mint(sys, sys.alice.account.address, tokens(100));
      await viem.assertions.revertWithCustomError(
        sys.token.write.transfer([sys.bob.account.address, tokens(10)], { account: sys.alice.account }),
        sys.token,
        "TransfersDisabled",
      );

      await sys.token.write.setTransfersEnabled([true], { account: sys.admin.account });
      await sys.token.write.transfer([sys.bob.account.address, tokens(10)], { account: sys.alice.account });
      assert.equal(await sys.token.read.balanceOf([sys.bob.account.address]), tokens(10));
    });

    it("exigen KYC vigente en destino y en origen", async function () {
      const sys = await networkHelpers.loadFixture(tokenFixture);
      await mint(sys, sys.alice.account.address, tokens(100));
      await sys.token.write.setTransfersEnabled([true], { account: sys.admin.account });

      await viem.assertions.revertWithCustomErrorWithArgs(
        sys.token.write.transfer([sys.mallory.account.address, tokens(1)], { account: sys.alice.account }),
        sys.token,
        "InvestorNotVerified",
        [sys.mallory.account.address],
      );

      // Baja del KYC de Alice: ya no puede mover sus tokens.
      await sys.registry.write.removeInvestor([sys.alice.account.address], { account: sys.agent.account });
      await viem.assertions.revertWithCustomErrorWithArgs(
        sys.token.write.transfer([sys.bob.account.address, tokens(1)], { account: sys.alice.account }),
        sys.token,
        "InvestorNotVerified",
        [sys.alice.account.address],
      );
    });

    it("transferFrom respeta las mismas reglas", async function () {
      const sys = await networkHelpers.loadFixture(tokenFixture);
      await mint(sys, sys.alice.account.address, tokens(100));
      await sys.token.write.setTransfersEnabled([true], { account: sys.admin.account });
      await sys.token.write.approve([sys.mallory.account.address, tokens(50)], { account: sys.alice.account });

      await viem.assertions.revertWithCustomErrorWithArgs(
        sys.token.write.transferFrom([sys.alice.account.address, sys.mallory.account.address, tokens(5)], {
          account: sys.mallory.account,
        }),
        sys.token,
        "InvestorNotVerified",
        [sys.mallory.account.address],
      );
      // Un tercero sin KYC puede operar como intermediario hacia un destino verificado.
      await sys.token.write.transferFrom([sys.alice.account.address, sys.bob.account.address, tokens(5)], {
        account: sys.mallory.account,
      });
      assert.equal(await sys.token.read.balanceOf([sys.bob.account.address]), tokens(5));
    });

    it("la pausa congela todo movimiento", async function () {
      const sys = await networkHelpers.loadFixture(tokenFixture);
      await mint(sys, sys.alice.account.address, tokens(100));
      await sys.token.write.setTransfersEnabled([true], { account: sys.admin.account });
      await sys.token.write.pause({ account: sys.admin.account });

      await viem.assertions.revertWithCustomError(
        sys.token.write.transfer([sys.bob.account.address, tokens(1)], { account: sys.alice.account }),
        sys.token,
        "EnforcedPause",
      );
      await viem.assertions.revertWithCustomError(
        sys.token.write.mint([sys.bob.account.address, tokens(1)], { account: sys.admin.account }),
        sys.token,
        "EnforcedPause",
      );

      await sys.token.write.unpause({ account: sys.admin.account });
      await sys.token.write.transfer([sys.bob.account.address, tokens(1)], { account: sys.alice.account });
    });
  });

  describe("distribuciones", function () {
    it("reparte a prorrata de la tenencia", async function () {
      const sys = await networkHelpers.loadFixture(tokenFixture);
      await mint(sys, sys.alice.account.address, tokens(7_500));
      await mint(sys, sys.bob.account.address, tokens(2_500));

      await viem.assertions.emitWithArgs(
        (async () => {
          await sys.usdcToken.write.approve([sys.token.address, usdc(1_000)], { account: sys.admin.account });
          return sys.token.write.distribute([usdc(1_000)], { account: sys.admin.account });
        })(),
        sys.token,
        "DistributionDeposited",
        [sys.admin.account.address, usdc(1_000)],
      );

      assertClose(await sys.token.read.withdrawableDistributionOf([sys.alice.account.address]), usdc(750));
      assertClose(await sys.token.read.withdrawableDistributionOf([sys.bob.account.address]), usdc(250));
      assert.equal(await sys.token.read.totalDistributed(), usdc(1_000));
    });

    it("transferir no altera lo devengado; el comprador solo cobra desde que compra", async function () {
      const sys = await networkHelpers.loadFixture(tokenFixture);
      await mint(sys, sys.alice.account.address, tokens(7_500));
      await mint(sys, sys.bob.account.address, tokens(2_500));
      await sys.token.write.setTransfersEnabled([true], { account: sys.admin.account });

      await distribute(sys, usdc(1_000));
      await sys.token.write.transfer([sys.carol.account.address, tokens(2_500)], { account: sys.alice.account });

      assertClose(await sys.token.read.withdrawableDistributionOf([sys.alice.account.address]), usdc(750));
      assert.equal(await sys.token.read.withdrawableDistributionOf([sys.carol.account.address]), 0n);

      await distribute(sys, usdc(1_000));
      // Alice: 750 + 50 % de 1.000; Bob: 250 + 25 %; Carol: 25 % de la segunda.
      assertClose(await sys.token.read.withdrawableDistributionOf([sys.alice.account.address]), usdc(1_250));
      assertClose(await sys.token.read.withdrawableDistributionOf([sys.bob.account.address]), usdc(500));
      assertClose(await sys.token.read.withdrawableDistributionOf([sys.carol.account.address]), usdc(250));
    });

    it("se cobra una sola vez y se puede acreditar en nombre del tenedor", async function () {
      const sys = await networkHelpers.loadFixture(tokenFixture);
      await mint(sys, sys.alice.account.address, tokens(1_000));
      await mint(sys, sys.bob.account.address, tokens(1_000));
      await distribute(sys, usdc(500));

      const aliceBefore = await sys.usdcToken.read.balanceOf([sys.alice.account.address]);
      await sys.token.write.claimDistributions({ account: sys.alice.account });
      assertClose((await sys.usdcToken.read.balanceOf([sys.alice.account.address])) - aliceBefore, usdc(250));
      await viem.assertions.revertWithCustomError(
        sys.token.write.claimDistributions({ account: sys.alice.account }),
        sys.token,
        "NothingToClaim",
      );

      // El backend puede pagarle a Bob sin que Bob firme nada: los fondos van a Bob.
      const bobBefore = await sys.usdcToken.read.balanceOf([sys.bob.account.address]);
      await sys.token.write.claimDistributionsFor([sys.bob.account.address], { account: sys.mallory.account });
      assertClose((await sys.usdcToken.read.balanceOf([sys.bob.account.address])) - bobBefore, usdc(250));
      assertClose(await sys.token.read.withdrawnDistributionOf([sys.bob.account.address]), usdc(250));
    });

    it("no paga a billeteras dadas de baja en KYC", async function () {
      const sys = await networkHelpers.loadFixture(tokenFixture);
      await mint(sys, sys.alice.account.address, tokens(1_000));
      await distribute(sys, usdc(100));
      await sys.registry.write.removeInvestor([sys.alice.account.address], { account: sys.agent.account });

      await viem.assertions.revertWithCustomErrorWithArgs(
        sys.token.write.claimDistributions({ account: sys.alice.account }),
        sys.token,
        "InvestorNotVerified",
        [sys.alice.account.address],
      );
    });

    it("solo el distribuidor deposita y exige un supply mínimo", async function () {
      const sys = await networkHelpers.loadFixture(tokenFixture);
      await viem.assertions.revertWithCustomErrorWithArgs(
        sys.token.write.distribute([usdc(1)], { account: sys.admin.account }),
        sys.token,
        "SupplyTooLow",
        [0n, tokens(1)],
      );
      // Caso encontrado por el fuzzer: 1 wei de supply dispararía el desborde.
      await mint(sys, sys.alice.account.address, 1n);
      await viem.assertions.revertWithCustomErrorWithArgs(
        sys.token.write.distribute([usdc(1)], { account: sys.admin.account }),
        sys.token,
        "SupplyTooLow",
        [1n, tokens(1)],
      );
      await mint(sys, sys.alice.account.address, tokens(1));
      await viem.assertions.revertWithCustomError(
        sys.token.write.distribute([usdc(1)], { account: sys.alice.account }),
        sys.token,
        "AccessControlUnauthorizedAccount",
      );
    });
  });

  describe("recuperación de billeteras", function () {
    it("mueve tokens y distribuciones pendientes, aun con el token pausado", async function () {
      const sys = await networkHelpers.loadFixture(tokenFixture);
      await mint(sys, sys.alice.account.address, tokens(600));
      await mint(sys, sys.bob.account.address, tokens(400));
      await distribute(sys, usdc(1_000));
      await sys.token.write.pause({ account: sys.admin.account });

      await viem.assertions.emitWithArgs(
        sys.token.write.recoverWallet([sys.alice.account.address, sys.carol.account.address], {
          account: sys.admin.account,
        }),
        sys.token,
        "WalletRecovered",
        [sys.alice.account.address, sys.carol.account.address, tokens(600), (pending: bigint) => pending > 0n],
      );

      assert.equal(await sys.token.read.balanceOf([sys.alice.account.address]), 0n);
      assert.equal(await sys.token.read.balanceOf([sys.carol.account.address]), tokens(600));
      assert.equal(await sys.token.read.withdrawableDistributionOf([sys.alice.account.address]), 0n);
      assertClose(await sys.token.read.withdrawableDistributionOf([sys.carol.account.address]), usdc(600));
      assertClose(await sys.token.read.withdrawableDistributionOf([sys.bob.account.address]), usdc(400));

      await sys.token.write.unpause({ account: sys.admin.account });
      await sys.token.write.claimDistributions({ account: sys.carol.account });
    });

    it("solo el fiduciario, y solo hacia una billetera verificada", async function () {
      const sys = await networkHelpers.loadFixture(tokenFixture);
      await mint(sys, sys.alice.account.address, tokens(10));
      await viem.assertions.revertWithCustomError(
        sys.token.write.recoverWallet([sys.alice.account.address, sys.bob.account.address], {
          account: sys.bob.account,
        }),
        sys.token,
        "AccessControlUnauthorizedAccount",
      );
      await viem.assertions.revertWithCustomErrorWithArgs(
        sys.token.write.recoverWallet([sys.alice.account.address, sys.mallory.account.address], {
          account: sys.admin.account,
        }),
        sys.token,
        "InvestorNotVerified",
        [sys.mallory.account.address],
      );
      await viem.assertions.revertWithCustomError(
        sys.token.write.recoverWallet([sys.alice.account.address, sys.alice.account.address], {
          account: sys.admin.account,
        }),
        sys.token,
        "InvalidRecovery",
      );
    });
  });

  describe("validaciones", function () {
    it("el constructor rechaza direcciones vacías", async function () {
      const sys = await networkHelpers.loadFixture(tokenFixture);
      await assert.rejects(
        viem.deployContract("AssetToken", [
          {
            name: "X",
            symbol: "X",
            maxSupply: tokens(1),
            admin: sys.admin.account.address,
            identityRegistry: "0x0000000000000000000000000000000000000000",
            distributionToken: sys.usdcToken.address,
            assetValuationUSD: 0n,
            expectedYieldBps: 0n,
            legalDocumentURI: "",
            legalDocumentHash: "0x0000000000000000000000000000000000000000000000000000000000000000",
          },
        ]),
        /ZeroAddress/,
      );
    });

    it("no acepta distribuciones vacías ni recuperar billeteras sin nada", async function () {
      const sys = await networkHelpers.loadFixture(tokenFixture);
      await mint(sys, sys.alice.account.address, tokens(10));
      await viem.assertions.revertWithCustomError(
        sys.token.write.distribute([0n], { account: sys.admin.account }),
        sys.token,
        "ZeroAmount",
      );
      await viem.assertions.revertWithCustomError(
        sys.token.write.recoverWallet([sys.mallory.account.address, sys.bob.account.address], {
          account: sys.admin.account,
        }),
        sys.token,
        "InvalidRecovery",
      );
    });

    it("el fiduciario puede migrar a otro registro de identidad", async function () {
      const sys = await networkHelpers.loadFixture(tokenFixture);
      const newRegistry = await viem.deployContract("IdentityRegistry", [sys.admin.account.address]);
      await viem.assertions.revertWithCustomError(
        sys.token.write.setIdentityRegistry([newRegistry.address], { account: sys.alice.account }),
        sys.token,
        "AccessControlUnauthorizedAccount",
      );
      await viem.assertions.emitWithArgs(
        sys.token.write.setIdentityRegistry([newRegistry.address], { account: sys.admin.account }),
        sys.token,
        "IdentityRegistryUpdated",
        [newRegistry.address],
      );
      // En el registro nuevo Alice todavía no está verificada.
      await viem.assertions.revertWithCustomError(
        sys.token.write.mint([sys.alice.account.address, tokens(1)], { account: sys.admin.account }),
        sys.token,
        "InvestorNotVerified",
      );
    });
  });

  describe("metadatos del activo", function () {
    it("ancla el documento legal por hash y solo el fiduciario lo actualiza", async function () {
      const sys = await networkHelpers.loadFixture(tokenFixture);
      const newHash = keccak256(stringToHex("adenda-1"));
      await viem.assertions.revertWithCustomError(
        sys.token.write.setLegalDocument(["ipfs://nuevo", newHash], { account: sys.alice.account }),
        sys.token,
        "AccessControlUnauthorizedAccount",
      );
      await viem.assertions.emitWithArgs(
        sys.token.write.setLegalDocument(["ipfs://nuevo", newHash], { account: sys.admin.account }),
        sys.token,
        "LegalDocumentUpdated",
        ["ipfs://nuevo", newHash],
      );
      assert.equal(await sys.token.read.legalDocumentHash(), newHash);
      assert.equal(await sys.token.read.legalDocumentURI(), "ipfs://nuevo");
    });

    it("actualiza valuación y rendimiento esperado", async function () {
      const sys = await networkHelpers.loadFixture(tokenFixture);
      await sys.token.write.setAssetInfo([400_000n, 1200n], { account: sys.admin.account });
      assert.equal(await sys.token.read.assetValuationUSD(), 400_000n);
      assert.equal(await sys.token.read.expectedYieldBps(), 1200n);
    });
  });
});
