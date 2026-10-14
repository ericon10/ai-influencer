CREATE TABLE "hook_variants" (
	"id" text PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"hook_id" text NOT NULL,
	"character_id" text NOT NULL,
	"text" text NOT NULL,
	"flags" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"job_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "hooks" (
	"id" text PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"product_id" text NOT NULL,
	"number" integer NOT NULL,
	"kind" text DEFAULT '' NOT NULL,
	"text" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "products" (
	"id" text PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"name" text NOT NULL,
	"claims" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"language" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"voices" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"notes" text DEFAULT '' NOT NULL,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "social_accounts" (
	"id" text PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"tag" text NOT NULL,
	"character_id" text,
	"product_id" text,
	"link" text DEFAULT '' NOT NULL,
	"code" text DEFAULT '' NOT NULL,
	"signups" integer DEFAULT 0 NOT NULL,
	"views" integer,
	"notes" text DEFAULT '' NOT NULL,
	"updated_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "hook_variants" ADD CONSTRAINT "hook_variants_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hooks" ADD CONSTRAINT "hooks_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "social_accounts" ADD CONSTRAINT "social_accounts_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "hook_variants_hook_idx" ON "hook_variants" USING btree ("account_id","hook_id","created_at");--> statement-breakpoint
CREATE INDEX "hooks_product_idx" ON "hooks" USING btree ("account_id","product_id","number");--> statement-breakpoint
CREATE INDEX "products_account_idx" ON "products" USING btree ("account_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "social_accounts_tag_uq" ON "social_accounts" USING btree ("account_id","tag");