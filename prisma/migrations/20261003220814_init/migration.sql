-- CreateEnum
CREATE TYPE "Category" AS ENUM ('INMUEBLES', 'AGRO', 'DEUDA_PYME', 'EMPRESAS');

-- CreateEnum
CREATE TYPE "ProjectStatus" AS ENUM ('PROXIMAMENTE', 'FONDEANDO', 'FINALIZADO', 'LIQUIDADO', 'CANCELADO');

-- CreateEnum
CREATE TYPE "KycStatus" AS ENUM ('NO_INICIADO', 'PENDIENTE', 'APROBADO', 'RECHAZADO');

-- CreateEnum
CREATE TYPE "DocumentType" AS ENUM ('CONTRATO_FIDEICOMISO', 'TASACION', 'PLAN_DE_NEGOCIOS', 'ESTADOS_CONTABLES', 'INFORME_AVANCE', 'OTRO');

-- CreateEnum
CREATE TYPE "InvestmentStatus" AS ENUM ('CONFIRMADA', 'REEMBOLSADA');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "walletAddress" TEXT NOT NULL,
    "email" TEXT,
    "fullName" TEXT,
    "taxId" TEXT,
    "isPep" BOOLEAN NOT NULL DEFAULT false,
    "termsAcceptedAt" TIMESTAMP(3),
    "kycStatus" "KycStatus" NOT NULL DEFAULT 'NO_INICIADO',
    "kycProvider" TEXT,
    "kycReference" TEXT,
    "kycRejectionReason" TEXT,
    "kycVerifiedAt" TIMESTAMP(3),
    "kycExpiresAt" TIMESTAMP(3),
    "whitelistTxHash" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Project" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "category" "Category" NOT NULL,
    "status" "ProjectStatus" NOT NULL DEFAULT 'PROXIMAMENTE',
    "location" TEXT NOT NULL,
    "issuer" TEXT NOT NULL,
    "trustee" TEXT NOT NULL,
    "highlights" TEXT[],
    "risks" TEXT[],
    "images" TEXT[],
    "targetAmountUSD" DECIMAL(18,6) NOT NULL,
    "softCapUSD" DECIMAL(18,6) NOT NULL,
    "collectedAmountUSD" DECIMAL(18,6) NOT NULL DEFAULT 0,
    "investorCount" INTEGER NOT NULL DEFAULT 0,
    "minTicketUSD" DECIMAL(18,6) NOT NULL,
    "tokenPriceUSD" DECIMAL(18,6) NOT NULL,
    "estimatedIrr" DECIMAL(5,2) NOT NULL,
    "capRate" DECIMAL(5,2),
    "termMonths" INTEGER NOT NULL,
    "assetValuationUSD" DECIMAL(18,2) NOT NULL,
    "opensAt" TIMESTAMP(3) NOT NULL,
    "closesAt" TIMESTAMP(3) NOT NULL,
    "chainId" INTEGER,
    "tokenSymbol" TEXT NOT NULL,
    "tokenAddress" TEXT,
    "offeringAddress" TEXT,
    "lastSyncedBlock" BIGINT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Project_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Document" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "type" "DocumentType" NOT NULL,
    "title" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "sha256" TEXT NOT NULL,
    "sizeBytes" INTEGER,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Document_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Investment" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "userId" TEXT,
    "investorWallet" TEXT NOT NULL,
    "amountUSD" DECIMAL(18,6) NOT NULL,
    "tokenAmount" DECIMAL(36,18) NOT NULL,
    "status" "InvestmentStatus" NOT NULL DEFAULT 'CONFIRMADA',
    "chainId" INTEGER NOT NULL,
    "txHash" TEXT NOT NULL,
    "logIndex" INTEGER NOT NULL,
    "blockNumber" BIGINT NOT NULL,
    "executedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Investment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Distribution" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "amountUSD" DECIMAL(18,6) NOT NULL,
    "chainId" INTEGER NOT NULL,
    "txHash" TEXT NOT NULL,
    "logIndex" INTEGER NOT NULL,
    "blockNumber" BIGINT NOT NULL,
    "executedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Distribution_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_walletAddress_key" ON "User"("walletAddress");

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "User_kycReference_key" ON "User"("kycReference");

-- CreateIndex
CREATE UNIQUE INDEX "Project_slug_key" ON "Project"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "Project_tokenAddress_key" ON "Project"("tokenAddress");

-- CreateIndex
CREATE UNIQUE INDEX "Project_offeringAddress_key" ON "Project"("offeringAddress");

-- CreateIndex
CREATE INDEX "Project_status_category_idx" ON "Project"("status", "category");

-- CreateIndex
CREATE UNIQUE INDEX "Document_projectId_url_key" ON "Document"("projectId", "url");

-- CreateIndex
CREATE INDEX "Investment_investorWallet_idx" ON "Investment"("investorWallet");

-- CreateIndex
CREATE INDEX "Investment_projectId_idx" ON "Investment"("projectId");

-- CreateIndex
CREATE UNIQUE INDEX "Investment_chainId_txHash_logIndex_key" ON "Investment"("chainId", "txHash", "logIndex");

-- CreateIndex
CREATE INDEX "Distribution_projectId_idx" ON "Distribution"("projectId");

-- CreateIndex
CREATE UNIQUE INDEX "Distribution_chainId_txHash_logIndex_key" ON "Distribution"("chainId", "txHash", "logIndex");

-- AddForeignKey
ALTER TABLE "Document" ADD CONSTRAINT "Document_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Investment" ADD CONSTRAINT "Investment_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Investment" ADD CONSTRAINT "Investment_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Distribution" ADD CONSTRAINT "Distribution_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
