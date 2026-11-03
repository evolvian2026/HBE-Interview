CREATE TABLE "aptitude_questions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"section" text NOT NULL,
	"difficulty" text DEFAULT 'medium' NOT NULL,
	"stem" text NOT NULL,
	"options" jsonb NOT NULL,
	"answer" integer NOT NULL,
	"explanation" text,
	"active" boolean DEFAULT true NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "screening_attempts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"candidacy_id" uuid NOT NULL,
	"org_id" uuid NOT NULL,
	"drive_id" uuid NOT NULL,
	"paper" jsonb NOT NULL,
	"answers" jsonb NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"deadline_at" timestamp with time zone NOT NULL,
	"submitted_at" timestamp with time zone,
	"submit_reason" text,
	"score" jsonb,
	"percent" real,
	"passed" boolean,
	"review_status" text,
	"reviewed_by" uuid,
	"reviewed_at" timestamp with time zone,
	"review_note" text,
	"focus_losses" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "screening_attempts_candidacy_id_unique" UNIQUE("candidacy_id")
);
--> statement-breakpoint
ALTER TABLE "candidacies" ADD COLUMN "college" text;--> statement-breakpoint
ALTER TABLE "aptitude_questions" ADD CONSTRAINT "aptitude_questions_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "aptitude_questions" ADD CONSTRAINT "aptitude_questions_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "screening_attempts" ADD CONSTRAINT "screening_attempts_candidacy_id_candidacies_id_fk" FOREIGN KEY ("candidacy_id") REFERENCES "public"."candidacies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "screening_attempts" ADD CONSTRAINT "screening_attempts_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "screening_attempts" ADD CONSTRAINT "screening_attempts_drive_id_drives_id_fk" FOREIGN KEY ("drive_id") REFERENCES "public"."drives"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "screening_attempts" ADD CONSTRAINT "screening_attempts_reviewed_by_users_id_fk" FOREIGN KEY ("reviewed_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "aptitude_org_section" ON "aptitude_questions" USING btree ("org_id","section");--> statement-breakpoint
CREATE INDEX "screening_drive" ON "screening_attempts" USING btree ("drive_id");