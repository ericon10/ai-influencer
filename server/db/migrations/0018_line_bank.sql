CREATE TABLE "bank_lines" (
	"id" text PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"import_id" text NOT NULL,
	"product_id" text,
	"comment" text NOT NULL,
	"likes" integer DEFAULT 0 NOT NULL,
	"replies" integer DEFAULT 0 NOT NULL,
	"video_account" text DEFAULT '' NOT NULL,
	"video_views" integer DEFAULT 0 NOT NULL,
	"video_url" text DEFAULT '' NOT NULL,
	"video_caption" text DEFAULT '' NOT NULL,
	"state" text DEFAULT 'new' NOT NULL,
	"tags" jsonb,
	"line" text DEFAULT '' NOT NULL,
	"skipped" text DEFAULT '' NOT NULL,
	"review" jsonb,
	"passed" boolean,
	"call" text,
	"called_at" timestamp with time zone,
	"used_post_id" text,
	"used_account_tag" text,
	"used_character_id" text,
	"used_text" text DEFAULT '' NOT NULL,
	"used_at" timestamp with time zone,
	"skips" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "bank_lines" ADD CONSTRAINT "bank_lines_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "bank_lines_account_idx" ON "bank_lines" USING btree ("account_id","likes");--> statement-breakpoint
CREATE INDEX "bank_lines_import_idx" ON "bank_lines" USING btree ("account_id","import_id");