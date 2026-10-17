CREATE TABLE "org_domains" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"domain" text NOT NULL,
	"verification_token" text NOT NULL,
	"verified_at" timestamp with time zone,
	"verified_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "org_domains_domain_unique" UNIQUE("domain")
);
--> statement-breakpoint
CREATE TABLE "sso_configs" (
	"org_id" uuid PRIMARY KEY NOT NULL,
	"issuer" text NOT NULL,
	"client_id" text NOT NULL,
	"client_secret" text NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"required" boolean DEFAULT false NOT NULL,
	"jit_role" text,
	"last_tested_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "logo" "bytea";--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "logo_mime" text;--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "brand_color" text;--> statement-breakpoint
ALTER TABLE "org_domains" ADD CONSTRAINT "org_domains_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sso_configs" ADD CONSTRAINT "sso_configs_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;