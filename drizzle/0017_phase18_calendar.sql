CREATE TABLE "calendar_connections" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"org_id" uuid NOT NULL,
	"provider" text NOT NULL,
	"account_email" text NOT NULL,
	"refresh_token" text NOT NULL,
	"access_token" text,
	"access_expires_at" timestamp with time zone,
	"last_error" text,
	"connected_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "panel_interviews" ADD COLUMN "auto_meeting" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "panel_interviews" ADD COLUMN "calendar_provider" text;--> statement-breakpoint
ALTER TABLE "panel_interviews" ADD COLUMN "calendar_event_id" text;--> statement-breakpoint
ALTER TABLE "panel_interviews" ADD COLUMN "calendar_owner_id" uuid;--> statement-breakpoint
ALTER TABLE "panel_interviews" ADD COLUMN "calendar_error" text;--> statement-breakpoint
ALTER TABLE "calendar_connections" ADD CONSTRAINT "calendar_connections_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calendar_connections" ADD CONSTRAINT "calendar_connections_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "panel_interviews" ADD CONSTRAINT "panel_interviews_calendar_owner_id_users_id_fk" FOREIGN KEY ("calendar_owner_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;