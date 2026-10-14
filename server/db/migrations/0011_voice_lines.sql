ALTER TABLE "sounds" ADD COLUMN "character_id" text;--> statement-breakpoint
ALTER TABLE "sounds" ADD COLUMN "meta" jsonb DEFAULT '{}'::jsonb NOT NULL;