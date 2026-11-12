-- AlterTable
ALTER TABLE "CategoryLearning" ADD COLUMN     "hypothesis" TEXT,
ADD COLUMN     "recommendation" TEXT,
ADD COLUMN     "share" DOUBLE PRECISION NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "GenerationRun" ADD COLUMN     "options" JSONB;
