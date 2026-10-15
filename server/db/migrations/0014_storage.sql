CREATE TABLE "trash_items" (
	"id" text PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"kind" text NOT NULL,
	"ref_id" text NOT NULL,
	"label" text DEFAULT '' NOT NULL,
	"character_id" text,
	"asset_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"restore" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"reason" text DEFAULT 'owner' NOT NULL,
	"deleted_by" text,
	"deleted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"purge_after" timestamp with time zone NOT NULL,
	"restored_at" timestamp with time zone,
	"purged_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "worker_status" ADD COLUMN "free_disk_mb" integer;--> statement-breakpoint
ALTER TABLE "worker_status" ADD COLUMN "disk_checked_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "trash_items" ADD CONSTRAINT "trash_items_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "trash_account_idx" ON "trash_items" USING btree ("account_id","deleted_at");