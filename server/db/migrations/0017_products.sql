ALTER TABLE "broll_clips" ADD COLUMN "product_id" text;--> statement-breakpoint
ALTER TABLE "content_items" ADD COLUMN "product_id" text;--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "writing" text DEFAULT '' NOT NULL;--> statement-breakpoint
UPDATE "products" SET "writing" = 'sidestep' WHERE lower(trim("name")) = 'sidestep';--> statement-breakpoint
UPDATE "content_items" SET "product_id" = "spec"->>'productId' WHERE "kind" = 'slideshow' AND coalesce("spec"->>'productId', '') <> '';--> statement-breakpoint
UPDATE "broll_clips" b SET "product_id" = p."id" FROM "products" p WHERE p."account_id" = b."account_id" AND p."archived_at" IS NULL AND lower(trim(p."name")) = lower(trim(b."product")) AND trim(b."product") <> '';
