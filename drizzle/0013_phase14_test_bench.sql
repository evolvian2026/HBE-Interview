CREATE TABLE "benchmark_cases" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"candidacy_id" uuid,
	"source_report_id" uuid,
	"title" text NOT NULL,
	"round_type" text NOT NULL,
	"bundle" jsonb NOT NULL,
	"extras" jsonb NOT NULL,
	"config" jsonb NOT NULL,
	"expected" jsonb NOT NULL,
	"expected_source" text NOT NULL,
	"original" jsonb,
	"notes" text,
	"active" boolean DEFAULT true NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "benchmark_results" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_id" uuid NOT NULL,
	"case_id" uuid,
	"case_title" text NOT NULL,
	"repeat" integer DEFAULT 1 NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"expected" jsonb NOT NULL,
	"params" jsonb,
	"round_score" real,
	"recommendation" text,
	"confidence" text,
	"disagreement" boolean,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "benchmark_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"label" text NOT NULL,
	"model" text NOT NULL,
	"model_override" boolean DEFAULT false NOT NULL,
	"repeats" integer DEFAULT 1 NOT NULL,
	"status" text DEFAULT 'running' NOT NULL,
	"trigger" text DEFAULT 'manual' NOT NULL,
	"case_count" integer NOT NULL,
	"summary" jsonb,
	"is_baseline" boolean DEFAULT false NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "ai_calls" ADD COLUMN "benchmark_run_id" uuid;--> statement-breakpoint
ALTER TABLE "benchmark_cases" ADD CONSTRAINT "benchmark_cases_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "benchmark_cases" ADD CONSTRAINT "benchmark_cases_candidacy_id_candidacies_id_fk" FOREIGN KEY ("candidacy_id") REFERENCES "public"."candidacies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "benchmark_cases" ADD CONSTRAINT "benchmark_cases_source_report_id_round_reports_id_fk" FOREIGN KEY ("source_report_id") REFERENCES "public"."round_reports"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "benchmark_cases" ADD CONSTRAINT "benchmark_cases_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "benchmark_results" ADD CONSTRAINT "benchmark_results_run_id_benchmark_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."benchmark_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "benchmark_results" ADD CONSTRAINT "benchmark_results_case_id_benchmark_cases_id_fk" FOREIGN KEY ("case_id") REFERENCES "public"."benchmark_cases"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "benchmark_runs" ADD CONSTRAINT "benchmark_runs_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "benchmark_runs" ADD CONSTRAINT "benchmark_runs_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "benchmark_case_report" ON "benchmark_cases" USING btree ("org_id","source_report_id");--> statement-breakpoint
CREATE INDEX "benchmark_case_org" ON "benchmark_cases" USING btree ("org_id","created_at");--> statement-breakpoint
CREATE INDEX "benchmark_result_run" ON "benchmark_results" USING btree ("run_id");--> statement-breakpoint
CREATE INDEX "benchmark_run_org" ON "benchmark_runs" USING btree ("org_id","created_at");