-- CreateEnum
CREATE TYPE "PricingMode" AS ENUM ('UNIT', 'WEIGHT');

-- AlterTable
ALTER TABLE "CashSession" ADD COLUMN     "terminal" TEXT;

-- AlterTable
ALTER TABLE "Product" ADD COLUMN     "pricingMode" "PricingMode" NOT NULL DEFAULT 'UNIT';

-- AlterTable
ALTER TABLE "Sale" ADD COLUMN     "terminal" TEXT;

-- Busca de produto no PDV: trigram + unaccent para tolerar acento e erro de
-- digitacao sem varrer a tabela inteira em catalogos grandes.
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS unaccent;

-- unaccent() e STABLE por padrao; a versao IMMUTABLE abaixo permite indexa-la.
CREATE OR REPLACE FUNCTION immutable_unaccent(text)
RETURNS text
LANGUAGE sql IMMUTABLE STRICT PARALLEL SAFE
AS $$ SELECT public.unaccent('public.unaccent'::regdictionary, $1) $$;

CREATE INDEX IF NOT EXISTS "Product_name_trgm_idx"
  ON "Product" USING gin (immutable_unaccent(lower("name")) gin_trgm_ops);

CREATE INDEX IF NOT EXISTS "Product_sku_trgm_idx"
  ON "Product" USING gin (lower("sku") gin_trgm_ops);
