CREATE TABLE "accommodations" (
	"candidacy_id" uuid PRIMARY KEY NOT NULL,
	"org_id" uuid NOT NULL,
	"extra_time_pct" integer DEFAULT 0 NOT NULL,
	"extra_breaks" boolean DEFAULT false NOT NULL,
	"details" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"approved_extra_time_pct" integer,
	"approved_extra_breaks" boolean,
	"decision_note" text,
	"decided_by" uuid,
	"decided_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "calibration_reviews" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"report_id" uuid NOT NULL,
	"candidacy_id" uuid NOT NULL,
	"drive_id" uuid NOT NULL,
	"round_type" text NOT NULL,
	"reviewer_id" uuid,
	"scores" jsonb NOT NULL,
	"recommendation" text NOT NULL,
	"notes" text,
	"ai" jsonb NOT NULL,
	"blind" boolean NOT NULL,
	"disagrees" boolean NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "round_reports" ADD COLUMN "calibration_requested_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "round_reports" ADD COLUMN "calibration_reason" text;--> statement-breakpoint
ALTER TABLE "accommodations" ADD CONSTRAINT "accommodations_candidacy_id_candidacies_id_fk" FOREIGN KEY ("candidacy_id") REFERENCES "public"."candidacies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "accommodations" ADD CONSTRAINT "accommodations_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "accommodations" ADD CONSTRAINT "accommodations_decided_by_users_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calibration_reviews" ADD CONSTRAINT "calibration_reviews_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calibration_reviews" ADD CONSTRAINT "calibration_reviews_report_id_round_reports_id_fk" FOREIGN KEY ("report_id") REFERENCES "public"."round_reports"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calibration_reviews" ADD CONSTRAINT "calibration_reviews_candidacy_id_candidacies_id_fk" FOREIGN KEY ("candidacy_id") REFERENCES "public"."candidacies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calibration_reviews" ADD CONSTRAINT "calibration_reviews_drive_id_drives_id_fk" FOREIGN KEY ("drive_id") REFERENCES "public"."drives"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calibration_reviews" ADD CONSTRAINT "calibration_reviews_reviewer_id_users_id_fk" FOREIGN KEY ("reviewer_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "calibration_report_reviewer" ON "calibration_reviews" USING btree ("report_id","reviewer_id");--> statement-breakpoint
CREATE INDEX "calibration_org_created" ON "calibration_reviews" USING btree ("org_id","created_at");