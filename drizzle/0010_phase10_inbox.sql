ALTER TABLE "users" ADD COLUMN "digest_opt_in" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "digest_sent_at" timestamp with time zone;