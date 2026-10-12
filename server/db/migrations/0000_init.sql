CREATE TABLE "account_settings" (
	"account_id" text NOT NULL,
	"key" text NOT NULL,
	"value" jsonb NOT NULL,
	"updated_by" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "account_settings_account_id_key_pk" PRIMARY KEY("account_id","key")
);
--> statement-breakpoint
CREATE TABLE "accounts" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "assets" (
	"id" text PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"kind" text NOT NULL,
	"storage_key" text NOT NULL,
	"mime" text NOT NULL,
	"bytes" bigint NOT NULL,
	"width" integer,
	"height" integer,
	"duration_ms" integer,
	"checksum_sha256" text NOT NULL,
	"origin" text NOT NULL,
	"source_job_id" text,
	"source_url" text,
	"label" text DEFAULT '' NOT NULL,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "audit_log" (
	"id" text PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"user_id" text,
	"action" text NOT NULL,
	"target_type" text DEFAULT '' NOT NULL,
	"target_id" text DEFAULT '' NOT NULL,
	"data" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "budgets" (
	"id" text PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"scope" text NOT NULL,
	"scope_ref" text DEFAULT '' NOT NULL,
	"cap_micros" bigint NOT NULL,
	"warn_pct" integer DEFAULT 80 NOT NULL,
	"updated_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "candidates" (
	"id" text PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"character_id" text NOT NULL,
	"target" text NOT NULL,
	"ref_id" text,
	"hero_prompt_index" integer,
	"job_id" text,
	"asset_id" text,
	"prompt" text DEFAULT '' NOT NULL,
	"status" text DEFAULT 'generating' NOT NULL,
	"qa_report" jsonb,
	"qa_verdict" text,
	"reject_reasons" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"reject_note" text DEFAULT '' NOT NULL,
	"favorite" boolean DEFAULT false NOT NULL,
	"reviewed_by" text,
	"reviewed_at" timestamp with time zone,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "character_inspirations" (
	"account_id" text NOT NULL,
	"character_id" text NOT NULL,
	"asset_id" text NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "character_inspirations_character_id_asset_id_pk" PRIMARY KEY("character_id","asset_id")
);
--> statement-breakpoint
CREATE TABLE "character_revisions" (
	"id" text PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"character_id" text NOT NULL,
	"revision" integer NOT NULL,
	"snapshot" jsonb NOT NULL,
	"reason" text DEFAULT '' NOT NULL,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "characters" (
	"id" text PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"stage" integer DEFAULT 1 NOT NULL,
	"age" integer,
	"card" text DEFAULT '' NOT NULL,
	"features" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"marks" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"body" text DEFAULT '' NOT NULL,
	"style" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"makeup" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"persona" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"avoid_models" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"preferred_models" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"identity_model" jsonb,
	"disclosure" text DEFAULT 'Label all posts as AI-generated' NOT NULL,
	"sheet_lock" jsonb,
	"breakdown" jsonb,
	"notes" text DEFAULT '' NOT NULL,
	"revision" integer DEFAULT 1 NOT NULL,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "concepts" (
	"id" text PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"character_id" text NOT NULL,
	"position" integer NOT NULL,
	"data" jsonb NOT NULL,
	"status" text DEFAULT 'proposed' NOT NULL,
	"source_job_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "job_events" (
	"id" text PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"job_id" text NOT NULL,
	"type" text NOT NULL,
	"data" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "job_outputs" (
	"account_id" text NOT NULL,
	"job_id" text NOT NULL,
	"position" integer NOT NULL,
	"asset_id" text NOT NULL,
	"provider_url" text,
	CONSTRAINT "job_outputs_job_id_position_pk" PRIMARY KEY("job_id","position")
);
--> statement-breakpoint
CREATE TABLE "jobs" (
	"id" text PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"user_id" text,
	"character_id" text,
	"stage" text NOT NULL,
	"purpose" text NOT NULL,
	"provider" text NOT NULL,
	"model" text NOT NULL,
	"kind" text NOT NULL,
	"request" jsonb NOT NULL,
	"idempotency_key" text NOT NULL,
	"quote_id" text,
	"estimate_micros" bigint NOT NULL,
	"actual_micros" bigint,
	"actual_source" text,
	"status" text NOT NULL,
	"provider_job_id" text,
	"webhook_token_hash" text,
	"attempts" integer DEFAULT 0 NOT NULL,
	"poll_count" integer DEFAULT 0 NOT NULL,
	"next_poll_at" timestamp with time zone,
	"last_polled_at" timestamp with time zone,
	"locked_until" timestamp with time zone,
	"error" jsonb,
	"result_meta" jsonb,
	"submitted_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ledger_entries" (
	"id" text PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"user_id" text,
	"character_id" text,
	"job_id" text,
	"quote_id" text,
	"stage" text DEFAULT '' NOT NULL,
	"provider" text DEFAULT '' NOT NULL,
	"model" text DEFAULT '' NOT NULL,
	"entry_type" text NOT NULL,
	"amount_micros" bigint NOT NULL,
	"quantity" double precision,
	"unit" text,
	"unit_price_micros" bigint,
	"price_version" text,
	"markup_micros" bigint DEFAULT 0 NOT NULL,
	"source" text DEFAULT 'computed' NOT NULL,
	"note" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "memberships" (
	"account_id" text NOT NULL,
	"user_id" text NOT NULL,
	"role" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "memberships_account_id_user_id_pk" PRIMARY KEY("account_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "provider_credentials" (
	"id" text PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"provider" text NOT NULL,
	"label" text DEFAULT '' NOT NULL,
	"key_version" text NOT NULL,
	"envelope" text NOT NULL,
	"last4" text NOT NULL,
	"verify_status" text DEFAULT 'unverified' NOT NULL,
	"verified_at" timestamp with time zone,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "quotes" (
	"id" text PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"user_id" text,
	"character_id" text,
	"purpose" text NOT NULL,
	"fingerprint" text NOT NULL,
	"items" jsonb NOT NULL,
	"total_micros" bigint NOT NULL,
	"budget" jsonb NOT NULL,
	"status" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ref_images" (
	"id" text PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"character_id" text NOT NULL,
	"ref_id" text NOT NULL,
	"view" text NOT NULL,
	"framing" text NOT NULL,
	"aspect" text NOT NULL,
	"depends_on" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"approved_candidate_id" text,
	"stale_reason" text DEFAULT '' NOT NULL,
	"stale_since" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"user_id" text NOT NULL,
	"token_hash" text NOT NULL,
	"user_agent" text DEFAULT '' NOT NULL,
	"ip" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" text PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"name" text DEFAULT '' NOT NULL,
	"password_hash" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "account_settings" ADD CONSTRAINT "account_settings_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assets" ADD CONSTRAINT "assets_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "budgets" ADD CONSTRAINT "budgets_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "candidates" ADD CONSTRAINT "candidates_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "candidates" ADD CONSTRAINT "candidates_character_id_characters_id_fk" FOREIGN KEY ("character_id") REFERENCES "public"."characters"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "character_inspirations" ADD CONSTRAINT "character_inspirations_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "character_inspirations" ADD CONSTRAINT "character_inspirations_character_id_characters_id_fk" FOREIGN KEY ("character_id") REFERENCES "public"."characters"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "character_revisions" ADD CONSTRAINT "character_revisions_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "character_revisions" ADD CONSTRAINT "character_revisions_character_id_characters_id_fk" FOREIGN KEY ("character_id") REFERENCES "public"."characters"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "characters" ADD CONSTRAINT "characters_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "concepts" ADD CONSTRAINT "concepts_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "concepts" ADD CONSTRAINT "concepts_character_id_characters_id_fk" FOREIGN KEY ("character_id") REFERENCES "public"."characters"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_events" ADD CONSTRAINT "job_events_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_events" ADD CONSTRAINT "job_events_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_outputs" ADD CONSTRAINT "job_outputs_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_outputs" ADD CONSTRAINT "job_outputs_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "provider_credentials" ADD CONSTRAINT "provider_credentials_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quotes" ADD CONSTRAINT "quotes_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ref_images" ADD CONSTRAINT "ref_images_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ref_images" ADD CONSTRAINT "ref_images_character_id_characters_id_fk" FOREIGN KEY ("character_id") REFERENCES "public"."characters"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "assets_account_idx" ON "assets" USING btree ("account_id","created_at");--> statement-breakpoint
CREATE INDEX "assets_checksum_idx" ON "assets" USING btree ("account_id","checksum_sha256");--> statement-breakpoint
CREATE INDEX "audit_account_idx" ON "audit_log" USING btree ("account_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "budgets_scope_uq" ON "budgets" USING btree ("account_id","scope","scope_ref");--> statement-breakpoint
CREATE INDEX "candidates_char_idx" ON "candidates" USING btree ("character_id","target","ref_id");--> statement-breakpoint
CREATE UNIQUE INDEX "char_rev_uq" ON "character_revisions" USING btree ("character_id","revision");--> statement-breakpoint
CREATE UNIQUE INDEX "characters_slug_uq" ON "characters" USING btree ("account_id","slug");--> statement-breakpoint
CREATE INDEX "concepts_char_idx" ON "concepts" USING btree ("character_id");--> statement-breakpoint
CREATE INDEX "job_events_job_idx" ON "job_events" USING btree ("job_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "jobs_idem_uq" ON "jobs" USING btree ("idempotency_key");--> statement-breakpoint
CREATE INDEX "jobs_due_idx" ON "jobs" USING btree ("status","next_poll_at");--> statement-breakpoint
CREATE INDEX "jobs_account_idx" ON "jobs" USING btree ("account_id","created_at");--> statement-breakpoint
CREATE INDEX "jobs_character_idx" ON "jobs" USING btree ("account_id","character_id");--> statement-breakpoint
CREATE INDEX "ledger_account_idx" ON "ledger_entries" USING btree ("account_id","created_at");--> statement-breakpoint
CREATE INDEX "ledger_character_idx" ON "ledger_entries" USING btree ("account_id","character_id");--> statement-breakpoint
CREATE INDEX "ledger_job_idx" ON "ledger_entries" USING btree ("job_id");--> statement-breakpoint
CREATE UNIQUE INDEX "cred_active_uq" ON "provider_credentials" USING btree ("account_id","provider") WHERE revoked_at is null;--> statement-breakpoint
CREATE UNIQUE INDEX "ref_images_uq" ON "ref_images" USING btree ("character_id","ref_id");--> statement-breakpoint
CREATE UNIQUE INDEX "sessions_token_uq" ON "sessions" USING btree ("token_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "users_email_uq" ON "users" USING btree ("email");