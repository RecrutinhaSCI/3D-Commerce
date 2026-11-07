-- OAuth Melhor Envio (Etapa 6): origem da lista de scopes concedidos.
-- Migration ADITIVA: uma coluna opcional. Linhas existentes ficam NULL
-- (= conexão legada, que pedia só "shipping-calculate").

-- AlterTable
ALTER TABLE "integration_credentials" ADD COLUMN     "scope_source" TEXT;
