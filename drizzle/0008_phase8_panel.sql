CREATE TABLE "hiring_decisions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"candidacy_id" uuid NOT NULL,
	"decision" text NOT NULL,
	"reason" text NOT NULL,
	"basis" jsonb,
	"decided_by" uuid,
	"candidate_notified_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "panel_interviews" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"candidacy_id" uuid NOT NULL,
	"title" text NOT NULL,
	"duration_min" integer NOT NULL,
	"location" text NOT NULL,
	"slots" jsonb NOT NULL,
	"scheduled_at" timestamp with time zone,
	"status" text DEFAULT 'proposed' NOT NULL,
	"candidate_message" text,
	"competencies" jsonb NOT NULL,
	"sequence" integer DEFAULT 0 NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "panel_scorecards" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"interview_id" uuid NOT NULL,
	"panelist_id" uuid NOT NULL,
	"ratings" jsonb,
	"recommendation" text,
	"strengths" text,
	"concerns" text,
	"submitted_at" timestamp with time zone,
	"reminded_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "hiring_decisions" ADD CONSTRAINT "hiring_decisions_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hiring_decisions" ADD CONSTRAINT "hiring_decisions_candidacy_id_candidacies_id_fk" FOREIGN KEY ("candidacy_id") REFERENCES "public"."candidacies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hiring_decisions" ADD CONSTRAINT "hiring_decisions_decided_by_users_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "panel_interviews" ADD CONSTRAINT "panel_interviews_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "panel_interviews" ADD CONSTRAINT "panel_interviews_candidacy_id_candidacies_id_fk" FOREIGN KEY ("candidacy_id") REFERENCES "public"."candidacies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "panel_interviews" ADD CONSTRAINT "panel_interviews_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "panel_scorecards" ADD CONSTRAINT "panel_scorecards_interview_id_panel_interviews_id_fk" FOREIGN KEY ("interview_id") REFERENCES "public"."panel_interviews"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "panel_scorecards" ADD CONSTRAINT "panel_scorecards_panelist_id_users_id_fk" FOREIGN KEY ("panelist_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "panel_candidacy" ON "panel_interviews" USING btree ("candidacy_id");--> statement-breakpoint
CREATE UNIQUE INDEX "scorecard_interview_panelist" ON "panel_scorecards" USING btree ("interview_id","panelist_id");