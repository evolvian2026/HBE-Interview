ALTER TABLE "candidacies" ADD COLUMN "source" text;--> statement-breakpoint
ALTER TABLE "candidates" ADD COLUMN "pool_consent_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "candidates" ADD COLUMN "pool_expires_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "candidates" ADD COLUMN "tags" jsonb DEFAULT '[]'::jsonb NOT NULL;