CREATE TABLE "scim_configs" (
	"org_id" uuid PRIMARY KEY NOT NULL,
	"token_hash" text NOT NULL,
	"token_prefix" text NOT NULL,
	"default_role" text DEFAULT 'viewer' NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"last_used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "scim_configs_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "scim_external_id" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "provisioned_by" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "scim_deprovisioned_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "scim_configs" ADD CONSTRAINT "scim_configs_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;