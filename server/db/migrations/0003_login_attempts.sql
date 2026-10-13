CREATE TABLE "login_attempts" (
	"id" text PRIMARY KEY NOT NULL,
	"account_id" text,
	"email" text NOT NULL,
	"ip" text DEFAULT '' NOT NULL,
	"ok" boolean NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "login_attempts_email_idx" ON "login_attempts" USING btree ("email","created_at");--> statement-breakpoint
CREATE INDEX "login_attempts_ip_idx" ON "login_attempts" USING btree ("ip","created_at");