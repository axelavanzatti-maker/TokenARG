-- CreateEnum
CREATE TYPE "ApplicationStatus" AS ENUM ('NUEVA', 'EN_EVALUACION', 'APROBADA', 'DESCARTADA');

-- CreateTable
CREATE TABLE "ProjectApplication" (
    "id" TEXT NOT NULL,
    "companyName" TEXT NOT NULL,
    "contactName" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "phone" TEXT,
    "category" "Category" NOT NULL,
    "location" TEXT NOT NULL,
    "amountUSD" DECIMAL(18,2) NOT NULL,
    "description" TEXT NOT NULL,
    "hasTrust" BOOLEAN NOT NULL DEFAULT false,
    "website" TEXT,
    "source" TEXT,
    "status" "ApplicationStatus" NOT NULL DEFAULT 'NUEVA',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProjectApplication_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WaitlistEntry" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT,
    "code" TEXT NOT NULL,
    "referredById" TEXT,
    "source" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WaitlistEntry_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ProjectApplication_createdAt_idx" ON "ProjectApplication"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "WaitlistEntry_email_key" ON "WaitlistEntry"("email");

-- CreateIndex
CREATE UNIQUE INDEX "WaitlistEntry_code_key" ON "WaitlistEntry"("code");

-- CreateIndex
CREATE INDEX "WaitlistEntry_createdAt_idx" ON "WaitlistEntry"("createdAt");

-- AddForeignKey
ALTER TABLE "WaitlistEntry" ADD CONSTRAINT "WaitlistEntry_referredById_fkey" FOREIGN KEY ("referredById") REFERENCES "WaitlistEntry"("id") ON DELETE SET NULL ON UPDATE CASCADE;
