ALTER TABLE "jobs" ADD COLUMN IF NOT EXISTS "cost_check" jsonb;--> statement-breakpoint
ALTER TABLE "scenes" ADD COLUMN IF NOT EXISTS "ran_fields" jsonb;
