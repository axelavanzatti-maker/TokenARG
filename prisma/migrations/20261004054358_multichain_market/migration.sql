-- CreateEnum
CREATE TYPE "Network" AS ENUM ('polygon', 'ethereum');

-- DropIndex
DROP INDEX "Project_tokenAddress_key";

-- DropIndex
DROP INDEX "Project_offeringAddress_key";

-- AlterTable
ALTER TABLE "User" DROP COLUMN "whitelistTxHash";

-- AlterTable
ALTER TABLE "Project" ADD COLUMN     "network" "Network" NOT NULL DEFAULT 'polygon';

-- CreateTable
CREATE TABLE "WalletVerification" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "chainId" INTEGER NOT NULL,
    "txHash" TEXT NOT NULL,
    "validUntil" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WalletVerification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChainDeployment" (
    "chainId" INTEGER NOT NULL,
    "network" "Network" NOT NULL,
    "identityRegistry" TEXT NOT NULL,
    "paymentToken" TEXT NOT NULL,
    "paymentRouter" TEXT NOT NULL,
    "market" TEXT NOT NULL,
    "buyerFeeBps" INTEGER NOT NULL,
    "sellerFeeBps" INTEGER NOT NULL,
    "minOrderValueUSD" DECIMAL(18,6) NOT NULL,
    "paymentAssets" JSONB NOT NULL,
    "startBlock" BIGINT NOT NULL,
    "deploymentRef" TEXT NOT NULL,
    "marketSyncedBlock" BIGINT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ChainDeployment_pkey" PRIMARY KEY ("chainId")
);

-- CreateTable
CREATE TABLE "Trade" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "chainId" INTEGER NOT NULL,
    "orderId" BIGINT NOT NULL,
    "buyer" TEXT NOT NULL,
    "seller" TEXT NOT NULL,
    "priceUSD" DECIMAL(18,6) NOT NULL,
    "tokenAmount" DECIMAL(36,18) NOT NULL,
    "valueUSD" DECIMAL(18,6) NOT NULL,
    "buyerFeeUSD" DECIMAL(18,6) NOT NULL,
    "sellerFeeUSD" DECIMAL(18,6) NOT NULL,
    "txHash" TEXT NOT NULL,
    "logIndex" INTEGER NOT NULL,
    "blockNumber" BIGINT NOT NULL,
    "executedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Trade_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "WalletVerification_userId_chainId_key" ON "WalletVerification"("userId", "chainId");

-- CreateIndex
CREATE INDEX "Trade_projectId_executedAt_idx" ON "Trade"("projectId", "executedAt");

-- CreateIndex
CREATE INDEX "Trade_buyer_idx" ON "Trade"("buyer");

-- CreateIndex
CREATE INDEX "Trade_seller_idx" ON "Trade"("seller");

-- CreateIndex
CREATE UNIQUE INDEX "Trade_chainId_txHash_logIndex_key" ON "Trade"("chainId", "txHash", "logIndex");

-- CreateIndex
CREATE UNIQUE INDEX "Project_chainId_tokenAddress_key" ON "Project"("chainId", "tokenAddress");

-- CreateIndex
CREATE UNIQUE INDEX "Project_chainId_offeringAddress_key" ON "Project"("chainId", "offeringAddress");

-- AddForeignKey
ALTER TABLE "WalletVerification" ADD CONSTRAINT "WalletVerification_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Trade" ADD CONSTRAINT "Trade_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
