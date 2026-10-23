ALTER TABLE "bank_lines" ADD COLUMN "source" text DEFAULT 'comment' NOT NULL;--> statement-breakpoint
ALTER TABLE "bank_lines" ADD COLUMN "life_or_job" text;--> statement-breakpoint
ALTER TABLE "bank_lines" ADD COLUMN "used_date" text;--> statement-breakpoint
ALTER TABLE "social_accounts" ADD COLUMN "device_id" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "social_accounts" ADD COLUMN "platform" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "social_accounts" ADD COLUMN "slots_per_day" integer;--> statement-breakpoint
ALTER TABLE "social_accounts" ADD COLUMN "life_share" integer;