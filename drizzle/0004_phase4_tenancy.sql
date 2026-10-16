CREATE TABLE "kb_chunks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"document_id" uuid NOT NULL,
	"ord" integer NOT NULL,
	"content" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "organizations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"ai_budget_usd" real,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "organizations_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
ALTER TABLE "candidates" DROP CONSTRAINT "candidates_email_unique";--> statement-breakpoint
ALTER TABLE "ai_calls" ADD COLUMN "org_id" uuid;--> statement-breakpoint
ALTER TABLE "api_keys" ADD COLUMN "org_id" uuid;--> statement-breakpoint
ALTER TABLE "audit_log" ADD COLUMN "org_id" uuid;--> statement-breakpoint
ALTER TABLE "candidacies" ADD COLUMN "org_id" uuid;--> statement-breakpoint
ALTER TABLE "candidates" ADD COLUMN "org_id" uuid;--> statement-breakpoint
ALTER TABLE "drives" ADD COLUMN "org_id" uuid;--> statement-breakpoint
ALTER TABLE "kb_documents" ADD COLUMN "org_id" uuid;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "org_id" uuid;--> statement-breakpoint
ALTER TABLE "webhooks" ADD COLUMN "org_id" uuid;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "platform_admin" boolean DEFAULT false NOT NULL;--> statement-breakpoint
-- Phase 4 backfill: everything that existed belongs to the original (default) organisation.
INSERT INTO "organizations" ("id", "name", "slug")
  VALUES ('00000000-0000-4000-8000-000000000001', COALESCE((SELECT "value"->>'companyName' FROM "settings" WHERE "key" = 'org'), 'HBE'), 'default');--> statement-breakpoint
UPDATE "api_keys" SET "org_id" = '00000000-0000-4000-8000-000000000001';--> statement-breakpoint
UPDATE "candidacies" SET "org_id" = '00000000-0000-4000-8000-000000000001';--> statement-breakpoint
UPDATE "candidates" SET "org_id" = '00000000-0000-4000-8000-000000000001';--> statement-breakpoint
UPDATE "drives" SET "org_id" = '00000000-0000-4000-8000-000000000001';--> statement-breakpoint
UPDATE "kb_documents" SET "org_id" = '00000000-0000-4000-8000-000000000001';--> statement-breakpoint
UPDATE "users" SET "org_id" = '00000000-0000-4000-8000-000000000001';--> statement-breakpoint
UPDATE "webhooks" SET "org_id" = '00000000-0000-4000-8000-000000000001';--> statement-breakpoint
UPDATE "ai_calls" SET "org_id" = '00000000-0000-4000-8000-000000000001';--> statement-breakpoint
UPDATE "audit_log" SET "org_id" = '00000000-0000-4000-8000-000000000001';--> statement-breakpoint
ALTER TABLE "api_keys" ALTER COLUMN "org_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "candidacies" ALTER COLUMN "org_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "candidates" ALTER COLUMN "org_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "drives" ALTER COLUMN "org_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "kb_documents" ALTER COLUMN "org_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ALTER COLUMN "org_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "webhooks" ALTER COLUMN "org_id" SET NOT NULL;--> statement-breakpoint
-- Existing admins operated the single internal tool, so they become platform admins.
UPDATE "users" SET "platform_admin" = true WHERE "role" = 'admin';--> statement-breakpoint
-- Model overrides move to platform settings; the org row is re-keyed per organisation.
INSERT INTO "settings" ("key", "value")
  SELECT 'platform', jsonb_build_object('models', COALESCE("value"->'models', '{}'::jsonb), 'interviewerEffort', COALESCE("value"->'interviewerEffort', '""'::jsonb))
  FROM "settings" WHERE "key" = 'org';--> statement-breakpoint
UPDATE "settings" SET "key" = 'org:00000000-0000-4000-8000-000000000001', "value" = "value" - 'models' - 'interviewerEffort' WHERE "key" = 'org';--> statement-breakpoint
ALTER TABLE "kb_chunks" ADD CONSTRAINT "kb_chunks_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kb_chunks" ADD CONSTRAINT "kb_chunks_document_id_kb_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."kb_documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "kb_chunks_fts" ON "kb_chunks" USING gin (to_tsvector('simple', "content"));--> statement-breakpoint
CREATE INDEX "kb_chunks_org" ON "kb_chunks" USING btree ("org_id");--> statement-breakpoint
ALTER TABLE "api_keys" ADD CONSTRAINT "api_keys_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "candidacies" ADD CONSTRAINT "candidacies_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "candidates" ADD CONSTRAINT "candidates_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "drives" ADD CONSTRAINT "drives_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kb_documents" ADD CONSTRAINT "kb_documents_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "webhooks" ADD CONSTRAINT "webhooks_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "candidate_org_email" ON "candidates" USING btree ("org_id","email");