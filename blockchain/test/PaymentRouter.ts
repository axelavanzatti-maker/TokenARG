import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { network } from "hardhat";
import { parseEther, parseUnits, zeroAddress } from "viem";
import { OfferingState, deploySystem, invest, tokens, usdc, type Connection } from "./fixtures.js";

const NATIVE = zeroAddress;
const wbtc = (n: number | string) => parseUnits(String(n), 8);

describe("PaymentRouter (pagar con otras monedas)", async function () {
  const conn: Connection = await network.create();
  const { viem, networkHelpers } = conn;

  /** Oferta abierta + router con el adaptador de prueba: ETH a USD 3.000 y WBTC a USD 100.000. */
  async function routerFixture() {
    const sys = await deploySystem(conn);
    const wbtcToken = await viem.deployContract("MockERC20", ["Wrapped BTC (Test)", "WBTC", 8, wbtc(10)]);
    const adapter = await viem.deployContract("MockSwapAdapter", [sys.admin.account.address, sys.usdcToken.address]);
    const router = await viem.deployContract("PaymentRouter", [sys.admin.account.address, sys.usdcToken.address, adapter.address]);
    await adapter.write.setPaymentRouter([router.address]);
    await adapter.write.setPrice([NATIVE, usdc(3_000), 18]);
    await adapter.write.setPrice([wbtcToken.address, usdc(100_000), 8]);
    await router.write.setAccepted([NATIVE, true]);
    await router.write.setAccepted([wbtcToken.address, true]);
    await sys.offering.write.setRouter([router.address, true]);
    await wbtcToken.write.mint([sys.alice.account.address, wbtc(1)]);
    const publicClient = await viem.getPublicClient();
    const latest = await publicClient.getBlock();
    return { ...sys, wbtcToken, adapter, router, publicClient, deadline: latest.timestamp + 600n };
  }

  it("invierte USD 300 pagando con ETH: cobra lo justo, devuelve el sobrante y los tokens son del inversor", async function () {
    const fx = await networkHelpers.loadFixture(routerFixture);
    const { result: quote } = await fx.publicClient.simulateContract({
      address: fx.router.address,
      abi: fx.router.abi,
      functionName: "quote",
      args: [NATIVE, usdc(300)],
    });
    assert.equal(quote, parseEther("0.1"));

    const maxIn = (quote * 101n) / 100n; // 1 % de tolerancia
    await viem.assertions.emitWithArgs(
      fx.router.write.buyWithAsset([fx.offering.address, NATIVE, usdc(300), maxIn, fx.deadline], {
        account: fx.alice.account,
        value: maxIn,
      }),
      fx.router,
      "PaidWithAsset",
      [(a: string) => a.toLowerCase() === fx.alice.account.address.toLowerCase(), (a: string) => a.toLowerCase() === fx.offering.address.toLowerCase(), NATIVE, quote, usdc(300)],
    );

    assert.equal(await fx.token.read.balanceOf([fx.alice.account.address]), tokens(300));
    assert.equal(await fx.offering.read.contributionOf([fx.alice.account.address]), usdc(300));
    assert.equal(await fx.usdcToken.read.balanceOf([fx.offering.address]), usdc(300));
    // El adaptador se quedó exactamente con lo cotizado; el router, sin saldo.
    assert.equal(await fx.publicClient.getBalance({ address: fx.adapter.address }), quote);
    assert.equal(await fx.publicClient.getBalance({ address: fx.router.address }), 0n);
    assert.equal(await fx.usdcToken.read.balanceOf([fx.router.address]), 0n);
  });

  it("invierte USD 500 pagando con WBTC (8 decimales) y devuelve lo que sobra", async function () {
    const fx = await networkHelpers.loadFixture(routerFixture);
    const before = await fx.wbtcToken.read.balanceOf([fx.alice.account.address]);
    await fx.wbtcToken.write.approve([fx.router.address, wbtc("0.006")], { account: fx.alice.account });
    await fx.router.write.buyWithAsset([fx.offering.address, fx.wbtcToken.address, usdc(500), wbtc("0.006"), fx.deadline], {
      account: fx.alice.account,
    });
    assert.equal(await fx.wbtcToken.read.balanceOf([fx.alice.account.address]), before - wbtc("0.005"));
    assert.equal(await fx.token.read.balanceOf([fx.alice.account.address]), tokens(500));
    assert.equal(await fx.wbtcToken.read.balanceOf([fx.router.address]), 0n);
  });

  it("rechaza tolerancia insuficiente, cotización vencida, monedas no aceptadas e inversores sin KYC", async function () {
    const fx = await networkHelpers.loadFixture(routerFixture);
    const tooLittle = parseEther("0.09");
    await viem.assertions.revertWithCustomError(
      fx.router.write.buyWithAsset([fx.offering.address, NATIVE, usdc(300), tooLittle, fx.deadline], {
        account: fx.alice.account,
        value: tooLittle,
      }),
      fx.router,
      "SlippageExceeded",
    );
    await viem.assertions.revertWithCustomError(
      fx.router.write.buyWithAsset([fx.offering.address, NATIVE, usdc(300), parseEther("0.2"), 1n], {
        account: fx.alice.account,
        value: parseEther("0.2"),
      }),
      fx.router,
      "Expired",
    );
    await viem.assertions.revertWithCustomError(
      fx.router.write.buyWithAsset([fx.offering.address, fx.usdcToken.address, usdc(300), usdc(300), fx.deadline], {
        account: fx.alice.account,
      }),
      fx.router,
      "AssetNotAccepted",
    );
    await viem.assertions.revertWithCustomError(
      fx.router.write.buyWithAsset([fx.offering.address, NATIVE, usdc(300), parseEther("0.2"), fx.deadline], {
        account: fx.mallory.account,
        value: parseEther("0.2"),
      }),
      fx.offering,
      "InvestorNotVerified",
    );
  });

  it("buyFor solo lo puede llamar un router autorizado", async function () {
    const fx = await networkHelpers.loadFixture(routerFixture);
    await fx.usdcToken.write.approve([fx.offering.address, usdc(300)], { account: fx.bob.account });
    await viem.assertions.revertWithCustomError(
      fx.offering.write.buyFor([fx.bob.account.address, usdc(300)], { account: fx.bob.account }),
      fx.offering,
      "NotRouter",
    );
    await fx.offering.write.setRouter([fx.router.address, false]);
    await viem.assertions.revertWithCustomError(
      fx.router.write.buyWithAsset([fx.offering.address, NATIVE, usdc(300), parseEther("0.2"), fx.deadline], {
        account: fx.alice.account,
        value: parseEther("0.2"),
      }),
      fx.offering,
      "NotRouter",
    );
  });

  it("si la ronda se cancela, el reembolso es en USDC y para el inversor (no para el router)", async function () {
    const fx = await networkHelpers.loadFixture(routerFixture);
    const maxIn = parseEther("0.11");
    await fx.router.write.buyWithAsset([fx.offering.address, NATIVE, usdc(300), maxIn, fx.deadline], {
      account: fx.alice.account,
      value: maxIn,
    });
    await fx.offering.write.cancel();
    assert.equal(await fx.offering.read.state(), OfferingState.Failed);

    const before = await fx.usdcToken.read.balanceOf([fx.alice.account.address]);
    await fx.offering.write.refund({ account: fx.alice.account });
    assert.equal(await fx.usdcToken.read.balanceOf([fx.alice.account.address]), before + usdc(300));
    assert.equal(await fx.token.read.balanceOf([fx.alice.account.address]), 0n);
  });

  it("convive con la compra directa en USDC", async function () {
    const fx = await networkHelpers.loadFixture(routerFixture);
    await invest(fx, fx.bob, usdc(1_000));
    const maxIn = parseEther("0.11");
    await fx.router.write.buyWithAsset([fx.offering.address, NATIVE, usdc(300), maxIn, fx.deadline], {
      account: fx.bob.account,
      value: maxIn,
    });
    assert.equal(await fx.offering.read.contributionOf([fx.bob.account.address]), usdc(1_300));
    assert.equal(await fx.offering.read.investorCount(), 1n);
  });

  describe("adaptador de Uniswap V3", function () {
    async function uniswapFixture() {
      const sys = await deploySystem(conn);
      const wrapped = await viem.deployContract("MockWrappedNative");
      const wbtcToken = await viem.deployContract("MockERC20", ["Wrapped BTC (Test)", "WBTC", 8, wbtc(10)]);
      const uni = await viem.deployContract("MockUniswapV3", [sys.usdcToken.address]);
      await uni.write.setPrice([wrapped.address, usdc(3_000), 18]);
      await uni.write.setPrice([wbtcToken.address, usdc(100_000), 8]);
      const adapter = await viem.deployContract("UniswapV3Adapter", [
        sys.admin.account.address,
        uni.address,
        uni.address,
        wrapped.address,
        sys.usdcToken.address,
      ]);
      const router = await viem.deployContract("PaymentRouter", [sys.admin.account.address, sys.usdcToken.address, adapter.address]);
      await adapter.write.setPaymentRouter([router.address]);
      await adapter.write.setPoolFee([NATIVE, 500]);
      await adapter.write.setPoolFee([wbtcToken.address, 3000]);
      await router.write.setAccepted([NATIVE, true]);
      await router.write.setAccepted([wbtcToken.address, true]);
      await sys.offering.write.setRouter([router.address, true]);
      await wbtcToken.write.mint([sys.alice.account.address, wbtc(1)]);
      const publicClient = await viem.getPublicClient();
      const deadline = (await publicClient.getBlock()).timestamp + 600n;
      return { ...sys, wrapped, wbtcToken, uni, adapter, router, publicClient, deadline };
    }

    it("envuelve la moneda nativa, usa el pool configurado y devuelve el sobrante desenvuelto", async function () {
      const fx = await networkHelpers.loadFixture(uniswapFixture);
      const maxIn = parseEther("0.2");
      await fx.router.write.buyWithAsset([fx.offering.address, NATIVE, usdc(300), maxIn, fx.deadline], {
        account: fx.alice.account,
        value: maxIn,
      });
      assert.equal(await fx.uni.read.lastFee(), 500);
      assert.equal(await fx.token.read.balanceOf([fx.alice.account.address]), tokens(300));
      assert.equal(await fx.wrapped.read.balanceOf([fx.uni.address]), parseEther("0.1"));
      assert.equal(await fx.publicClient.getBalance({ address: fx.adapter.address }), 0n);
      assert.equal(await fx.wrapped.read.balanceOf([fx.adapter.address]), 0n);
    });

    it("cotiza y opera con WBTC en el pool de 0,3 %", async function () {
      const fx = await networkHelpers.loadFixture(uniswapFixture);
      const { result: quote } = await fx.publicClient.simulateContract({
        address: fx.router.address,
        abi: fx.router.abi,
        functionName: "quote",
        args: [fx.wbtcToken.address, usdc(1_000)],
      });
      assert.equal(quote, wbtc("0.01"));
      await fx.wbtcToken.write.approve([fx.router.address, wbtc("0.011")], { account: fx.alice.account });
      await fx.router.write.buyWithAsset([fx.offering.address, fx.wbtcToken.address, usdc(1_000), wbtc("0.011"), fx.deadline], {
        account: fx.alice.account,
      });
      assert.equal(await fx.uni.read.lastFee(), 3000);
      assert.equal(await fx.wbtcToken.read.balanceOf([fx.alice.account.address]), wbtc("0.99"));
    });

    it("solo responde al router configurado y exige pools configurados", async function () {
      const fx = await networkHelpers.loadFixture(uniswapFixture);
      await viem.assertions.revertWithCustomError(
        fx.adapter.write.swapExactOutput([NATIVE, usdc(1), 1n, fx.alice.account.address, fx.alice.account.address], {
          account: fx.alice.account,
          value: 1n,
        }),
        fx.adapter,
        "NotPaymentRouter",
      );
      await fx.adapter.write.setPoolFee([NATIVE, 0]);
      await viem.assertions.revertWithCustomError(
        fx.router.write.buyWithAsset([fx.offering.address, NATIVE, usdc(300), parseEther("0.2"), fx.deadline], {
          account: fx.alice.account,
          value: parseEther("0.2"),
        }),
        fx.adapter,
        "PoolNotConfigured",
      );
    });
  });
});
