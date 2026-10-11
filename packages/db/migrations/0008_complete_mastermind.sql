CREATE TABLE "automation_enrollments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"automation_id" uuid NOT NULL,
	"contact_id" uuid NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"current_step_id" text,
	"next_run_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_recipient_id" uuid,
	"entered_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"exit_reason" text,
	CONSTRAINT "automation_enrollments_status_check" CHECK ("automation_enrollments"."status" in ('active','completed','exited'))
);
--> statement-breakpoint
CREATE TABLE "automations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"name" text NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"trigger" jsonb NOT NULL,
	"steps" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"activated_at" timestamp with time zone,
	"created_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "automations_status_check" CHECK ("automations"."status" in ('draft','active','paused','archived'))
);
--> statement-breakpoint
ALTER TABLE "contact_tags" ADD COLUMN "added_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "campaigns" ADD COLUMN "kind" text DEFAULT 'campaign' NOT NULL;--> statement-breakpoint
ALTER TABLE "campaigns" ADD COLUMN "automation_id" uuid;--> statement-breakpoint
ALTER TABLE "campaigns" ADD COLUMN "automation_step_id" text;--> statement-breakpoint
ALTER TABLE "automation_enrollments" ADD CONSTRAINT "automation_enrollments_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "automation_enrollments" ADD CONSTRAINT "automation_enrollments_automation_id_automations_id_fk" FOREIGN KEY ("automation_id") REFERENCES "public"."automations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "automation_enrollments" ADD CONSTRAINT "automation_enrollments_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "automation_enrollments" ADD CONSTRAINT "automation_enrollments_last_recipient_id_campaign_recipients_id_fk" FOREIGN KEY ("last_recipient_id") REFERENCES "public"."campaign_recipients"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "automations" ADD CONSTRAINT "automations_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "automations" ADD CONSTRAINT "automations_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "automation_enrollments_uidx" ON "automation_enrollments" USING btree ("automation_id","contact_id");--> statement-breakpoint
CREATE INDEX "automation_enrollments_due_idx" ON "automation_enrollments" USING btree ("next_run_at") WHERE "automation_enrollments"."status" = 'active';--> statement-breakpoint
CREATE INDEX "automations_org_idx" ON "automations" USING btree ("organization_id","created_at");--> statement-breakpoint
CREATE INDEX "automations_active_idx" ON "automations" USING btree ("status") WHERE "automations"."status" = 'active';--> statement-breakpoint
ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_automation_id_automations_id_fk" FOREIGN KEY ("automation_id") REFERENCES "public"."automations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "campaigns_automation_idx" ON "campaigns" USING btree ("automation_id","automation_step_id") WHERE "campaigns"."automation_id" is not null;--> statement-breakpoint
ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_kind_check" CHECK ("campaigns"."kind" in ('campaign','automation_step'));