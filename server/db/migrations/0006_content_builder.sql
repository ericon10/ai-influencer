CREATE TABLE "broll_clips" (
	"id" text PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"asset_id" text,
	"title" text DEFAULT '' NOT NULL,
	"product" text DEFAULT '' NOT NULL,
	"status" text DEFAULT 'processing' NOT NULL,
	"error" text,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "content_items" (
	"id" text PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"character_id" text,
	"kind" text NOT NULL,
	"title" text DEFAULT '' NOT NULL,
	"spec" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"outputs" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"error" text,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "broll_clips" ADD CONSTRAINT "broll_clips_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_items" ADD CONSTRAINT "content_items_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "broll_account_idx" ON "broll_clips" USING btree ("account_id","created_at");--> statement-breakpoint
CREATE INDEX "content_account_idx" ON "content_items" USING btree ("account_id","created_at");