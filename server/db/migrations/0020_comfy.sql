CREATE TABLE "comfy_loras" (
	"id" text PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"character_id" text NOT NULL,
	"base" text NOT NULL,
	"version" integer NOT NULL,
	"trigger" text NOT NULL,
	"state" text DEFAULT 'training' NOT NULL,
	"task_id" text,
	"file_name" text,
	"sha256" text,
	"images" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"active" boolean DEFAULT false NOT NULL,
	"steps" integer DEFAULT 2000 NOT NULL,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "comfy_tasks" (
	"id" text PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"job_id" text,
	"character_id" text,
	"user_id" text,
	"key" text NOT NULL,
	"kind" text NOT NULL,
	"workflow_id" text NOT NULL,
	"workflow_version" integer DEFAULT 1 NOT NULL,
	"family" text NOT NULL,
	"graph" jsonb NOT NULL,
	"inputs" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"recipe" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"state" text DEFAULT 'queued' NOT NULL,
	"attempt" integer DEFAULT 1 NOT NULL,
	"batch" integer DEFAULT 1 NOT NULL,
	"lease_until" timestamp with time zone,
	"claimed_at" timestamp with time zone,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"timeout_sec" integer DEFAULT 900 NOT NULL,
	"progress" double precision DEFAULT 0 NOT NULL,
	"claim_token" text,
	"outputs" jsonb,
	"result" jsonb,
	"error" text,
	"fail_reason" text,
	"env_hash" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "comfy_loras" ADD CONSTRAINT "comfy_loras_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comfy_tasks" ADD CONSTRAINT "comfy_tasks_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "comfy_loras_version_uq" ON "comfy_loras" USING btree ("account_id","character_id","base","version");--> statement-breakpoint
CREATE INDEX "comfy_loras_character_idx" ON "comfy_loras" USING btree ("account_id","character_id");--> statement-breakpoint
CREATE UNIQUE INDEX "comfy_tasks_key_uq" ON "comfy_tasks" USING btree ("account_id","key");--> statement-breakpoint
CREATE INDEX "comfy_tasks_state_idx" ON "comfy_tasks" USING btree ("account_id","state","created_at");--> statement-breakpoint
CREATE INDEX "comfy_tasks_job_idx" ON "comfy_tasks" USING btree ("job_id");