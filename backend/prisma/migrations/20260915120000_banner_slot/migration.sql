-- CreateEnum
CREATE TYPE "BannerSlot" AS ENUM ('HERO', 'PROMO');

-- AlterTable
ALTER TABLE "banners" ADD COLUMN "slot" "BannerSlot" NOT NULL DEFAULT 'HERO';

-- CreateIndex
CREATE INDEX "banners_slot_idx" ON "banners"("slot");
