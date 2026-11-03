CREATE TABLE "code_fingerprints" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"session_id" uuid NOT NULL,
	"candidacy_id" uuid NOT NULL,
	"drive_id" uuid NOT NULL,
	"problem_id" text NOT NULL,
	"language" text NOT NULL,
	"code_run_id" uuid,
	"hashes" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "code_matches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"problem_id" text NOT NULL,
	"a_id" uuid NOT NULL,
	"b_id" uuid,
	"reference_id" uuid,
	"score" real NOT NULL,
	"level" text NOT NULL,
	"lines_a" jsonb NOT NULL,
	"lines_b" jsonb NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"review_note" text,
	"reviewed_by" uuid,
	"reviewed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "code_match_pair" UNIQUE NULLS NOT DISTINCT("a_id","b_id","reference_id")
);
--> statement-breakpoint
CREATE TABLE "code_references" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"problem_id" text NOT NULL,
	"language" text NOT NULL,
	"source" text NOT NULL,
	"code" text NOT NULL,
	"hashes" jsonb NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "code_fingerprints" ADD CONSTRAINT "code_fingerprints_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "code_fingerprints" ADD CONSTRAINT "code_fingerprints_session_id_round_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."round_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "code_fingerprints" ADD CONSTRAINT "code_fingerprints_candidacy_id_candidacies_id_fk" FOREIGN KEY ("candidacy_id") REFERENCES "public"."candidacies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "code_fingerprints" ADD CONSTRAINT "code_fingerprints_drive_id_drives_id_fk" FOREIGN KEY ("drive_id") REFERENCES "public"."drives"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "code_fingerprints" ADD CONSTRAINT "code_fingerprints_code_run_id_code_runs_id_fk" FOREIGN KEY ("code_run_id") REFERENCES "public"."code_runs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "code_matches" ADD CONSTRAINT "code_matches_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "code_matches" ADD CONSTRAINT "code_matches_a_id_code_fingerprints_id_fk" FOREIGN KEY ("a_id") REFERENCES "public"."code_fingerprints"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "code_matches" ADD CONSTRAINT "code_matches_b_id_code_fingerprints_id_fk" FOREIGN KEY ("b_id") REFERENCES "public"."code_fingerprints"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "code_matches" ADD CONSTRAINT "code_matches_reference_id_code_references_id_fk" FOREIGN KEY ("reference_id") REFERENCES "public"."code_references"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "code_matches" ADD CONSTRAINT "code_matches_reviewed_by_users_id_fk" FOREIGN KEY ("reviewed_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "code_references" ADD CONSTRAINT "code_references_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "code_references" ADD CONSTRAINT "code_references_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "fingerprint_session_problem" ON "code_fingerprints" USING btree ("session_id","problem_id");--> statement-breakpoint
CREATE INDEX "fingerprint_org_problem" ON "code_fingerprints" USING btree ("org_id","problem_id","language");--> statement-breakpoint
CREATE INDEX "code_match_org_status" ON "code_matches" USING btree ("org_id","status");--> statement-breakpoint
CREATE INDEX "code_reference_org_problem" ON "code_references" USING btree ("org_id","problem_id");