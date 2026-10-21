-- Categoria: imagem do card da Home e flags de exibição persistidas.
-- Só adiciona colunas (com default); o código antigo continua funcionando.
-- Antes, "Mostrar no menu" no admin alterava `active` e "Mostrar na home"
-- não era gravado — os defaults `true` preservam o comportamento atual.
ALTER TABLE "categories" ADD COLUMN "image_url" TEXT;
ALTER TABLE "categories" ADD COLUMN "show_in_menu" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "categories" ADD COLUMN "show_in_home" BOOLEAN NOT NULL DEFAULT true;
