CREATE TABLE "scenes" (
	"id" text PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"character_id" text NOT NULL,
	"title" text DEFAULT '' NOT NULL,
	"brief" text DEFAULT '' NOT NULL,
	"fields" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"combo_logged_at" timestamp with time zone,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "candidates" ADD COLUMN "scene_id" text;--> statement-breakpoint
ALTER TABLE "candidates" ADD COLUMN "parent_id" text;--> statement-breakpoint
ALTER TABLE "candidates" ADD COLUMN "op" text DEFAULT 'generate' NOT NULL;--> statement-breakpoint
ALTER TABLE "scenes" ADD CONSTRAINT "scenes_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scenes" ADD CONSTRAINT "scenes_character_id_characters_id_fk" FOREIGN KEY ("character_id") REFERENCES "public"."characters"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "scenes_char_idx" ON "scenes" USING btree ("character_id","created_at");--> statement-breakpoint
CREATE INDEX "candidates_scene_idx" ON "candidates" USING btree ("scene_id");