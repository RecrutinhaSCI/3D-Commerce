-- AlterTable
ALTER TABLE "product_images" ADD COLUMN     "media_type" TEXT NOT NULL DEFAULT 'image',
ADD COLUMN     "mime_type" TEXT;
