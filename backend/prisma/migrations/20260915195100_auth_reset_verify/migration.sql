-- AlterTable
ALTER TABLE "users" ADD COLUMN     "email_verified" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "email_verify_expires_at" TIMESTAMP(3),
ADD COLUMN     "email_verify_token_hash" TEXT,
ADD COLUMN     "password_reset_expires_at" TIMESTAMP(3),
ADD COLUMN     "password_reset_token_hash" TEXT;
