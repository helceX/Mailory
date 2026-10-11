CREATE TABLE "sender_domains" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"domain" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"provider" text NOT NULL,
	"dkim_tokens" jsonb NOT NULL,
	"ownership_token" text NOT NULL,
	"ownership_ok" boolean DEFAULT false NOT NULL,
	"dkim_ok" boolean DEFAULT false NOT NULL,
	"spf_state" text,
	"dmarc_state" text,
	"last_check" jsonb,
	"last_error" text,
	"last_checked_at" timestamp with time zone,
	"failing_since" timestamp with time zone,
	"verified_at" timestamp with time zone,
	"created_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sender_domains_status_check" CHECK ("sender_domains"."status" in ('pending','verified','failed')),
	CONSTRAINT "sender_domains_domain_lower_check" CHECK ("sender_domains"."domain" = lower("sender_domains"."domain"))
);
--> statement-breakpoint
CREATE TABLE "sender_identities" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"from_name" text NOT NULL,
	"from_email" text NOT NULL,
	"reply_to" text,
	"is_default" boolean DEFAULT false NOT NULL,
	"created_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sender_identities_email_lower_check" CHECK ("sender_identities"."from_email" = lower("sender_identities"."from_email"))
);
--> statement-breakpoint
ALTER TABLE "sender_domains" ADD CONSTRAINT "sender_domains_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sender_domains" ADD CONSTRAINT "sender_domains_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sender_identities" ADD CONSTRAINT "sender_identities_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sender_identities" ADD CONSTRAINT "sender_identities_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "sender_domains_org_domain_uidx" ON "sender_domains" USING btree ("organization_id","domain");--> statement-breakpoint
CREATE UNIQUE INDEX "sender_domains_verified_domain_uidx" ON "sender_domains" USING btree ("domain") WHERE "sender_domains"."status" = 'verified';--> statement-breakpoint
CREATE INDEX "sender_domains_due_idx" ON "sender_domains" USING btree ("status","last_checked_at");--> statement-breakpoint
CREATE UNIQUE INDEX "sender_identities_org_email_uidx" ON "sender_identities" USING btree ("organization_id","from_email");--> statement-breakpoint
CREATE UNIQUE INDEX "sender_identities_one_default_uidx" ON "sender_identities" USING btree ("organization_id") WHERE "sender_identities"."is_default";