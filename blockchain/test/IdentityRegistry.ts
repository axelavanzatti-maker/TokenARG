import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { network } from "hardhat";
import { zeroAddress } from "viem";
import { DAY, deploySystem, type Connection } from "./fixtures.js";

describe("IdentityRegistry", async function () {
  const conn: Connection = await network.create();
  const { viem, networkHelpers } = conn;

  async function systemFixture() {
    return deploySystem(conn);
  }

  it("solo un agente KYC puede registrar inversores", async function () {
    const { registry, mallory } = await networkHelpers.loadFixture(systemFixture);
    const validUntil = BigInt(await networkHelpers.time.latest()) + 30n * DAY;

    await viem.assertions.revertWithCustomError(
      registry.write.registerInvestor([mallory.account.address, validUntil], { account: mallory.account }),
      registry,
      "AccessControlUnauthorizedAccount",
    );
  });

  it("registra, informa vencimiento y emite el evento", async function () {
    const { registry, agent, mallory } = await networkHelpers.loadFixture(systemFixture);
    const validUntil = BigInt(await networkHelpers.time.latest()) + 30n * DAY;

    assert.equal(await registry.read.isVerified([mallory.account.address]), false);
    await viem.assertions.emitWithArgs(
      registry.write.registerInvestor([mallory.account.address, validUntil], { account: agent.account }),
      registry,
      "InvestorRegistered",
      [mallory.account.address, validUntil, agent.account.address],
    );
    assert.equal(await registry.read.isVerified([mallory.account.address]), true);
    assert.equal(await registry.read.verificationExpiry([mallory.account.address]), validUntil);
  });

  it("la verificación vence sola", async function () {
    const { registry, agent, mallory } = await networkHelpers.loadFixture(systemFixture);
    const validUntil = BigInt(await networkHelpers.time.latest()) + 10n * DAY;
    await registry.write.registerInvestor([mallory.account.address, validUntil], { account: agent.account });

    await networkHelpers.time.increaseTo(validUntil);
    assert.equal(await registry.read.isVerified([mallory.account.address]), true, "válida hasta el último segundo");
    await networkHelpers.time.increase(1);
    assert.equal(await registry.read.isVerified([mallory.account.address]), false);
  });

  it("la baja es inmediata", async function () {
    const { registry, agent, alice } = await networkHelpers.loadFixture(systemFixture);
    await viem.assertions.emitWithArgs(
      registry.write.removeInvestor([alice.account.address], { account: agent.account }),
      registry,
      "InvestorRemoved",
      [alice.account.address, agent.account.address],
    );
    assert.equal(await registry.read.isVerified([alice.account.address]), false);
    assert.equal(await registry.read.verificationExpiry([alice.account.address]), 0n);
  });

  it("rechaza dirección cero, vencimientos pasados y lotes inconsistentes", async function () {
    const { registry, agent, mallory, carol } = await networkHelpers.loadFixture(systemFixture);
    const now = BigInt(await networkHelpers.time.latest());

    await viem.assertions.revertWithCustomError(
      registry.write.registerInvestor([zeroAddress, now + DAY], { account: agent.account }),
      registry,
      "ZeroAddress",
    );
    await viem.assertions.revertWithCustomErrorWithArgs(
      registry.write.registerInvestor([mallory.account.address, now], { account: agent.account }),
      registry,
      "InvalidExpiry",
      [now],
    );
    await viem.assertions.revertWithCustomError(
      registry.write.batchRegisterInvestors([[mallory.account.address, carol.account.address], [now + DAY]], {
        account: agent.account,
      }),
      registry,
      "LengthMismatch",
    );
  });

  it("registra en lote", async function () {
    const { registry, agent, mallory, treasury } = await networkHelpers.loadFixture(systemFixture);
    const validUntil = BigInt(await networkHelpers.time.latest()) + DAY;
    await registry.write.batchRegisterInvestors(
      [
        [mallory.account.address, treasury.account.address],
        [validUntil, validUntil],
      ],
      { account: agent.account },
    );
    assert.equal(await registry.read.isVerified([mallory.account.address]), true);
    assert.equal(await registry.read.isVerified([treasury.account.address]), true);
  });
});
