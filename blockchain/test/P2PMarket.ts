import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { network } from "hardhat";
import { assertClose, deploySystem, distribute, invest, tokens, usdc, type Connection } from "./fixtures.js";

const SELL = 0;
const BUY = 1;
const FEE_BPS = 50; // 0,5 % por parte

describe("P2PMarket", async function () {
  const conn: Connection = await network.create();
  const { viem, networkHelpers } = conn;

  /** Ronda completa, transferencias habilitadas y mercado con 0,5 % por parte. */
  async function marketFixture() {
    const sys = await deploySystem(conn);
    const [, , , , , , , feeWallet] = await viem.getWalletClients();
    await invest(sys, sys.alice, usdc(5_000)); // 5.000 tokens a USD 1
    await invest(sys, sys.bob, usdc(1_000));
    await sys.token.write.setTransfersEnabled([true]);
    const market = await viem.deployContract("P2PMarket", [
      sys.admin.account.address,
      sys.usdcToken.address,
      feeWallet!.account.address,
      FEE_BPS,
      FEE_BPS,
      usdc(10),
    ]);
    await market.write.setListed([sys.token.address, true]);
    return { ...sys, market, feeWallet: feeWallet! };
  }

  type Fx = Awaited<ReturnType<typeof marketFixture>>;

  async function listForSale(fx: Fx, amount: bigint, price: bigint) {
    await fx.token.write.approve([fx.market.address, amount], { account: fx.alice.account });
    await fx.market.write.createOrder([fx.token.address, SELL, amount, price], { account: fx.alice.account });
    return fx.market.read.nextOrderId();
  }

  it("una venta se liquida en el acto: tokens al comprador, USDC al vendedor y 0,5 % de comisión a cada parte", async function () {
    const fx = await networkHelpers.loadFixture(marketFixture);
    const id = await listForSale(fx, tokens(400), usdc("1.10"));

    // 400 tokens × 1,10 = 440 USDC; comisión 2,20 + 2,20
    const [value, buyerFee] = await fx.market.read.quoteBuy([tokens(400), usdc("1.10")]);
    assert.equal(value, usdc(440));
    assert.equal(buyerFee, usdc("2.2"));

    const before = {
      alice: await fx.usdcToken.read.balanceOf([fx.alice.account.address]),
      bob: await fx.usdcToken.read.balanceOf([fx.bob.account.address]),
    };
    await fx.usdcToken.write.approve([fx.market.address, value + buyerFee], { account: fx.bob.account });
    const same = (expected: string) => (actual: string) => actual.toLowerCase() === expected.toLowerCase();
    await viem.assertions.emitWithArgs(
      fx.market.write.fillOrder([id, tokens(400)], { account: fx.bob.account }),
      fx.market,
      "OrderFilled",
      [
        id,
        same(fx.token.address),
        same(fx.bob.account.address),
        same(fx.alice.account.address),
        usdc("1.10"),
        tokens(400),
        usdc(440),
        usdc("2.2"),
        usdc("2.2"),
      ],
    );

    assert.equal(await fx.token.read.balanceOf([fx.bob.account.address]), tokens(1_400));
    assert.equal(await fx.token.read.balanceOf([fx.alice.account.address]), tokens(4_600));
    assert.equal(await fx.usdcToken.read.balanceOf([fx.alice.account.address]), before.alice + usdc("437.8"));
    assert.equal(await fx.usdcToken.read.balanceOf([fx.bob.account.address]), before.bob - usdc("442.2"));
    assert.equal(await fx.usdcToken.read.balanceOf([fx.feeWallet.account.address]), usdc("4.4"));

    const order = await fx.market.read.getOrder([id]);
    assert.equal(order.active, false);
    assert.equal((await fx.market.read.getActiveOrders([fx.token.address])).length, 0);
    assert.equal(await fx.market.read.sellCommitted([fx.alice.account.address, fx.token.address]), 0n);
  });

  it("acepta tomas parciales y mantiene el libro de órdenes activo", async function () {
    const fx = await networkHelpers.loadFixture(marketFixture);
    const id = await listForSale(fx, tokens(1_000), usdc(1));
    // 1.000 USDC de valor + 0,5 % de comisión del comprador
    await fx.usdcToken.write.approve([fx.market.address, usdc(1_005)], { account: fx.bob.account });

    await fx.market.write.fillOrder([id, tokens(250)], { account: fx.bob.account });
    let book = await fx.market.read.getActiveOrders([fx.token.address]);
    assert.equal(book.length, 1);
    assert.equal(book[0]!.remaining, tokens(750));
    assert.equal(book[0]!.fillable, tokens(750));

    // Una toma parcial por menos de 1 USDC no se acepta (polvo)
    await viem.assertions.revertWithCustomError(
      fx.market.write.fillOrder([id, tokens("0.5")], { account: fx.bob.account }),
      fx.market,
      "FillTooSmall",
    );
    await fx.market.write.fillOrder([id, tokens(750)], { account: fx.bob.account });
    book = await fx.market.read.getActiveOrders([fx.token.address]);
    assert.equal(book.length, 0);
  });

  it("una orden de compra se liquida cuando un tenedor le vende", async function () {
    const fx = await networkHelpers.loadFixture(marketFixture);
    // Carol (con KYC, sin tokens) ofrece comprar 100 tokens a 0,95
    const [value, fee] = await fx.market.read.quoteBuy([tokens(100), usdc("0.95")]);
    await fx.usdcToken.write.approve([fx.market.address, value + fee], { account: fx.carol.account });
    await fx.market.write.createOrder([fx.token.address, BUY, tokens(100), usdc("0.95")], { account: fx.carol.account });
    const id = await fx.market.read.nextOrderId();
    assert.equal(await fx.market.read.buyCommittedValue([fx.carol.account.address]), usdc(95));

    const aliceUsdc = await fx.usdcToken.read.balanceOf([fx.alice.account.address]);
    await fx.token.write.approve([fx.market.address, tokens(100)], { account: fx.alice.account });
    await fx.market.write.fillOrder([id, tokens(100)], { account: fx.alice.account });

    assert.equal(await fx.token.read.balanceOf([fx.carol.account.address]), tokens(100));
    assert.equal(await fx.usdcToken.read.balanceOf([fx.alice.account.address]), aliceUsdc + usdc("94.525"));
    assert.equal(await fx.usdcToken.read.balanceOf([fx.feeWallet.account.address]), usdc("0.95"));
    assert.equal(await fx.market.read.buyCommittedValue([fx.carol.account.address]), 0n);
  });

  it("respeta las reglas del token: KYC de ambas partes y mercado habilitado por el fiduciario", async function () {
    const fx = await networkHelpers.loadFixture(marketFixture);
    const id = await listForSale(fx, tokens(100), usdc(1));

    // Mallory no tiene KYC
    await fx.usdcToken.write.approve([fx.market.address, usdc(200)], { account: fx.mallory.account });
    await viem.assertions.revertWithCustomErrorWithArgs(
      fx.market.write.fillOrder([id, tokens(100)], { account: fx.mallory.account }),
      fx.market,
      "InvestorNotVerified",
      [(a: string) => a.toLowerCase() === fx.mallory.account.address.toLowerCase()],
    );

    // Con el mercado secundario apagado no se publica ni se opera
    await fx.token.write.setTransfersEnabled([false]);
    await fx.usdcToken.write.approve([fx.market.address, usdc(200)], { account: fx.bob.account });
    await viem.assertions.revertWithCustomError(
      fx.market.write.fillOrder([id, tokens(100)], { account: fx.bob.account }),
      fx.market,
      "TransfersDisabled",
    );
    await viem.assertions.revertWithCustomError(
      fx.market.write.createOrder([fx.token.address, SELL, tokens(10), usdc(1)], { account: fx.bob.account }),
      fx.market,
      "TransfersDisabled",
    );
  });

  it("valida montos, autorizaciones, autocompra y tokens no listados", async function () {
    const fx = await networkHelpers.loadFixture(marketFixture);
    const { market, token, alice } = fx;

    await viem.assertions.revertWithCustomError(
      market.write.createOrder([token.address, SELL, tokens(5), usdc(1)], { account: alice.account }),
      market,
      "OrderTooSmall",
    );
    await viem.assertions.revertWithCustomError(
      market.write.createOrder([token.address, SELL, tokens(100), usdc(1)], { account: alice.account }),
      market,
      "InsufficientAllowance",
    );
    await viem.assertions.revertWithCustomError(
      market.write.createOrder([fx.usdcToken.address, SELL, tokens(100), usdc(1)], { account: alice.account }),
      market,
      "TokenNotListed",
    );
    const id = await listForSale(fx, tokens(100), usdc(1));
    await fx.usdcToken.write.approve([market.address, usdc(200)], { account: alice.account });
    await viem.assertions.revertWithCustomError(
      market.write.fillOrder([id, tokens(100)], { account: alice.account }),
      market,
      "SelfTrade",
    );
    // No se puede comprometer más de lo que se tiene: la segunda venta excede el saldo de Alice
    await fx.token.write.approve([market.address, tokens(6_000)], { account: alice.account });
    await viem.assertions.revertWithCustomError(
      market.write.createOrder([token.address, SELL, tokens(4_950), usdc(1)], { account: alice.account }),
      market,
      "InsufficientBalance",
    );
  });

  it("solo quien publicó (o la administración) puede retirar una orden", async function () {
    const fx = await networkHelpers.loadFixture(marketFixture);
    const id = await listForSale(fx, tokens(100), usdc(1));
    await viem.assertions.revertWithCustomError(
      fx.market.write.cancelOrder([id], { account: fx.bob.account }),
      fx.market,
      "NotOrderMaker",
    );
    await viem.assertions.emit(fx.market.write.cancelOrder([id], { account: fx.alice.account }), fx.market, "OrderCancelled");
    assert.equal(await fx.market.read.sellCommitted([fx.alice.account.address, fx.token.address]), 0n);

    const id2 = await listForSale(fx, tokens(100), usdc(1));
    await fx.market.write.cancelOrder([id2]); // admin
    await viem.assertions.revertWithCustomError(
      fx.market.write.fillOrder([id2, tokens(100)], { account: fx.bob.account }),
      fx.market,
      "OrderNotActive",
    );
  });

  it("una orden sin respaldo deja de ser tomable y no mueve fondos", async function () {
    const fx = await networkHelpers.loadFixture(marketFixture);
    const id = await listForSale(fx, tokens(100), usdc(1));
    // Alice revoca la autorización después de publicar
    await fx.token.write.approve([fx.market.address, 0n], { account: fx.alice.account });
    const [view] = await fx.market.read.getActiveOrders([fx.token.address]);
    assert.equal(view!.fillable, 0n);

    await fx.usdcToken.write.approve([fx.market.address, usdc(200)], { account: fx.bob.account });
    await viem.assertions.revertWithCustomError(
      fx.market.write.fillOrder([id, tokens(100)], { account: fx.bob.account }),
      fx.token,
      "ERC20InsufficientAllowance",
    );
    assert.equal(await fx.token.read.balanceOf([fx.bob.account.address]), tokens(1_000));
  });

  it("las rentas se devengan para quien tiene los tokens mientras la venta está publicada", async function () {
    const fx = await networkHelpers.loadFixture(marketFixture);
    const id = await listForSale(fx, tokens(3_000), usdc(1));
    await distribute(fx, usdc(600)); // 6.000 tokens en circulación: 0,10 USDC por token
    await fx.usdcToken.write.approve([fx.market.address, usdc(4_000)], { account: fx.bob.account });
    await fx.market.write.fillOrder([id, tokens(3_000)], { account: fx.bob.account });

    // La renta depositada antes de la venta es de Alice; Bob no se lleva lo devengado.
    assertClose(await fx.token.read.withdrawableDistributionOf([fx.alice.account.address]), usdc(500));
    assertClose(await fx.token.read.withdrawableDistributionOf([fx.bob.account.address]), usdc(100));
  });

  it("la comisión tiene tope y la administra solo el admin", async function () {
    const fx = await networkHelpers.loadFixture(marketFixture);
    await viem.assertions.revertWithCustomError(fx.market.write.setFees([201, 50]), fx.market, "FeeTooHigh");
    await viem.assertions.revertWithCustomError(
      fx.market.write.setFees([10, 10], { account: fx.bob.account }),
      fx.market,
      "AccessControlUnauthorizedAccount",
    );
    await viem.assertions.emitWithArgs(fx.market.write.setFees([30, 30]), fx.market, "FeesUpdated", [30, 30]);

    await fx.market.write.pause();
    await viem.assertions.revertWithCustomError(
      fx.market.write.createOrder([fx.token.address, SELL, tokens(100), usdc(1)], { account: fx.alice.account }),
      fx.market,
      "EnforcedPause",
    );
  });
});
