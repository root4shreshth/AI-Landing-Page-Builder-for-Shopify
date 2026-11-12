-- CreateTable
CREATE TABLE "Brand" (
    "id" TEXT NOT NULL,
    "domain" TEXT NOT NULL,
    "name" TEXT,
    "profile" JSONB NOT NULL,
    "confidence" JSONB NOT NULL,
    "extracted" JSONB NOT NULL,
    "editedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Brand_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Product" (
    "id" TEXT NOT NULL,
    "sourceUrl" TEXT NOT NULL,
    "handle" TEXT,
    "title" TEXT NOT NULL,
    "category" TEXT,
    "facts" JSONB NOT NULL,
    "brandId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Product_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductVariant" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "sourceVariantId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "options" JSONB NOT NULL,
    "priceCents" INTEGER,
    "compareAtCents" INTEGER,
    "available" BOOLEAN,
    "sku" TEXT,

    CONSTRAINT "ProductVariant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GenerationRun" (
    "id" TEXT NOT NULL,
    "productId" TEXT,
    "inputUrl" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'queued',
    "stage" TEXT NOT NULL DEFAULT 'queued',
    "stages" JSONB NOT NULL DEFAULT '[]',
    "error" TEXT,
    "cost" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GenerationRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Competitor" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "domain" TEXT NOT NULL,
    "title" TEXT,
    "isIndianD2C" BOOLEAN,
    "relevance" DOUBLE PRECISION,
    "rationale" TEXT,
    "crawlStatus" TEXT NOT NULL DEFAULT 'pending',
    "crawlError" TEXT,
    "capturedAt" TIMESTAMP(3),
    "screenshots" JSONB,
    "structure" JSONB,

    CONSTRAINT "Competitor_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CompetitorFinding" (
    "id" TEXT NOT NULL,
    "competitorId" TEXT NOT NULL,
    "feature" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "evidence" TEXT,

    CONSTRAINT "CompetitorFinding_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CategoryLearning" (
    "id" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "statement" TEXT NOT NULL,
    "supportCount" INTEGER NOT NULL,
    "sampleSize" INTEGER NOT NULL,
    "sources" JSONB NOT NULL,
    "runId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CategoryLearning_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Design" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "direction" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "config" JSONB NOT NULL,
    "templateKey" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "checks" JSONB,
    "version" INTEGER NOT NULL DEFAULT 1,
    "parentId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Design_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DesignFingerprint" (
    "id" TEXT NOT NULL,
    "designId" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "features" JSONB NOT NULL,
    "similarity" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DesignFingerprint_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DesignFeedback" (
    "id" TEXT NOT NULL,
    "designId" TEXT NOT NULL,
    "verdict" TEXT NOT NULL,
    "reason" TEXT,
    "tags" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DesignFeedback_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PublishHistory" (
    "id" TEXT NOT NULL,
    "designIds" JSONB NOT NULL,
    "method" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "store" TEXT,
    "themeId" TEXT,
    "themeName" TEXT,
    "previewUrl" TEXT,
    "editorUrl" TEXT,
    "zipPath" TEXT,
    "log" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PublishHistory_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Brand_domain_key" ON "Brand"("domain");

-- CreateIndex
CREATE INDEX "Product_category_idx" ON "Product"("category");

-- CreateIndex
CREATE INDEX "CategoryLearning_category_idx" ON "CategoryLearning"("category");

-- CreateIndex
CREATE UNIQUE INDEX "DesignFingerprint_designId_key" ON "DesignFingerprint"("designId");

-- CreateIndex
CREATE INDEX "DesignFingerprint_category_idx" ON "DesignFingerprint"("category");

-- AddForeignKey
ALTER TABLE "Product" ADD CONSTRAINT "Product_brandId_fkey" FOREIGN KEY ("brandId") REFERENCES "Brand"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductVariant" ADD CONSTRAINT "ProductVariant_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GenerationRun" ADD CONSTRAINT "GenerationRun_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Competitor" ADD CONSTRAINT "Competitor_runId_fkey" FOREIGN KEY ("runId") REFERENCES "GenerationRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompetitorFinding" ADD CONSTRAINT "CompetitorFinding_competitorId_fkey" FOREIGN KEY ("competitorId") REFERENCES "Competitor"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Design" ADD CONSTRAINT "Design_runId_fkey" FOREIGN KEY ("runId") REFERENCES "GenerationRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DesignFingerprint" ADD CONSTRAINT "DesignFingerprint_designId_fkey" FOREIGN KEY ("designId") REFERENCES "Design"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DesignFeedback" ADD CONSTRAINT "DesignFeedback_designId_fkey" FOREIGN KEY ("designId") REFERENCES "Design"("id") ON DELETE CASCADE ON UPDATE CASCADE;
