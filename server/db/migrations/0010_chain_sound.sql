CREATE TABLE "sounds" (
	"id" text PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"kind" text NOT NULL,
	"asset_id" text,
	"title" text DEFAULT '' NOT NULL,
	"tag" text DEFAULT '' NOT NULL,
	"duration_ms" integer,
	"loudness" double precision,
	"status" text DEFAULT 'processing' NOT NULL,
	"error" text,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "candidates" ADD COLUMN "meta" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "sounds" ADD CONSTRAINT "sounds_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "sounds_account_idx" ON "sounds" USING btree ("account_id","kind","created_at");