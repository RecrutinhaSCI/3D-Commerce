-- Conteúdo editável dos posts do Blog (título, categoria, resumo, tempo de
-- leitura e texto em Markdown), por slug. Só adiciona coluna NULL: sem valor
-- salvo, o site usa os textos padrão do código (código antigo não é afetado).
ALTER TABLE "site_settings" ADD COLUMN "blog_content_json" JSONB;
