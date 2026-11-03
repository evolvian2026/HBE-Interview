CREATE TABLE "hire_reviews" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"hire_id" uuid NOT NULL,
	"org_id" uuid NOT NULL,
	"checkpoint" integer NOT NULL,
	"due_at" timestamp with time zone NOT NULL,
	"reviewer_id" uuid,
	"rating" integer,
	"technical" integer,
	"collaboration" integer,
	"values" integer,
	"would_rehire" text,
	"note" text,
	"submitted_at" timestamp with time zone,
	"reminded_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "hires" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"candidacy_id" uuid,
	"drive_id" uuid,
	"role_title" text NOT NULL,
	"status" text DEFAULT 'offered' NOT NULL,
	"joined_at" timestamp with time zone,
	"left_at" timestamp with time zone,
	"left_reason" text,
	"manager_id" uuid,
	"snapshot" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "hires_candidacy_id_unique" UNIQUE("candidacy_id")
);
--> statement-breakpoint
ALTER TABLE "hire_reviews" ADD CONSTRAINT "hire_reviews_hire_id_hires_id_fk" FOREIGN KEY ("hire_id") REFERENCES "public"."hires"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hire_reviews" ADD CONSTRAINT "hire_reviews_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hire_reviews" ADD CONSTRAINT "hire_reviews_reviewer_id_users_id_fk" FOREIGN KEY ("reviewer_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hires" ADD CONSTRAINT "hires_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hires" ADD CONSTRAINT "hires_candidacy_id_candidacies_id_fk" FOREIGN KEY ("candidacy_id") REFERENCES "public"."candidacies"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hires" ADD CONSTRAINT "hires_drive_id_drives_id_fk" FOREIGN KEY ("drive_id") REFERENCES "public"."drives"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hires" ADD CONSTRAINT "hires_manager_id_users_id_fk" FOREIGN KEY ("manager_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "hire_review_checkpoint" ON "hire_reviews" USING btree ("hire_id","checkpoint");--> statement-breakpoint
CREATE INDEX "hire_review_due" ON "hire_reviews" USING btree ("reviewer_id","due_at");--> statement-breakpoint
CREATE INDEX "hires_org_created" ON "hires" USING btree ("org_id","created_at");