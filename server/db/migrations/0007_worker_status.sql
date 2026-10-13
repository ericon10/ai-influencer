CREATE TABLE "worker_status" (
	"id" text PRIMARY KEY NOT NULL,
	"version" text,
	"commit" text,
	"started_at" timestamp with time zone,
	"last_seen_at" timestamp with time zone,
	"wake_failed_at" timestamp with time zone,
	"wake_error" text,
	"waiting_for" text,
	"waiting_since" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
