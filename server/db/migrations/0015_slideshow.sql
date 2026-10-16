CREATE TABLE "slide_scenes" (
	"id" text PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"character_id" text,
	"topic" text DEFAULT '' NOT NULL,
	"name" text NOT NULL,
	"place" text DEFAULT '' NOT NULL,
	"light" text DEFAULT '' NOT NULL,
	"camera" text DEFAULT '' NOT NULL,
	"phone" text DEFAULT '' NOT NULL,
	"details" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"look_asset_id" text,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "content_items" ADD COLUMN "variation_of" text;--> statement-breakpoint
ALTER TABLE "content_items" ADD COLUMN "batch_of" text;--> statement-breakpoint
ALTER TABLE "slide_scenes" ADD CONSTRAINT "slide_scenes_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "slide_scenes_account_idx" ON "slide_scenes" USING btree ("account_id","created_at");--> statement-breakpoint
CREATE INDEX "content_family_idx" ON "content_items" USING btree ("account_id","variation_of");--> statement-breakpoint
CREATE INDEX "content_batch_idx" ON "content_items" USING btree ("account_id","batch_of");