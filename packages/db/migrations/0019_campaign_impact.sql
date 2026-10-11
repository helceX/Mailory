CREATE TABLE "campaign_impact_members" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"campaign_id" uuid NOT NULL,
	"contact_id" uuid,
	"email" text NOT NULL,
	"arm" text NOT NULL,
	"assigned_at" timestamp with time zone NOT NULL,
	CONSTRAINT "impact_arm_check" CHECK ("campaign_impact_members"."arm" in ('treatment','control'))
);
--> statement-breakpoint
ALTER TABLE "campaign_impact_members" ADD CONSTRAINT "campaign_impact_members_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaign_impact_members" ADD CONSTRAINT "campaign_impact_members_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaign_impact_members" ADD CONSTRAINT "campaign_impact_members_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "impact_campaign_email_uidx" ON "campaign_impact_members" USING btree ("campaign_id","email");--> statement-breakpoint
CREATE INDEX "conversions_impact_idx" ON "conversions" USING btree ("organization_id","name","occurred_at");