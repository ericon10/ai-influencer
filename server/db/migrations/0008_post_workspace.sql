ALTER TABLE "candidates" ADD COLUMN "label" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "content_items" ADD COLUMN "idea" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "content_items" ADD COLUMN "scene_id" text;--> statement-breakpoint
ALTER TABLE "content_items" ADD COLUMN "account_tag" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "content_items" ADD COLUMN "step" text DEFAULT 'idea' NOT NULL;