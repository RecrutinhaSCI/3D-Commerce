-- LGPD: registro do aceite da Política de Privacidade (data + versão).
ALTER TABLE "users" ADD COLUMN "privacy_consent_at" TIMESTAMP(3),
ADD COLUMN "privacy_policy_version" TEXT;
