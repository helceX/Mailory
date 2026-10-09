CREATE TABLE "conversions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"name" text NOT NULL,
	"email" text,
	"contact_id" uuid,
	"campaign_id" uuid,
	"recipient_id" uuid,
	"attribution" text,
	"value" numeric(14, 2) DEFAULT '0' NOT NULL,
	"currency" text DEFAULT 'TRY' NOT NULL,
	"external_id" text,
	"occurred_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "conversions_attribution_chk" CHECK ("conversions"."attribution" in ('click','send') or "conversions"."attribution" is null),
	CONSTRAINT "conversions_value_chk" CHECK ("conversions"."value" >= 0)
);
--> statement-breakpoint
ALTER TABLE "conversions" ADD CONSTRAINT "conversions_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversions" ADD CONSTRAINT "conversions_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversions" ADD CONSTRAINT "conversions_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversions" ADD CONSTRAINT "conversions_recipient_id_campaign_recipients_id_fk" FOREIGN KEY ("recipient_id") REFERENCES "public"."campaign_recipients"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "conversions_campaign_idx" ON "conversions" USING btree ("organization_id","campaign_id","occurred_at");--> statement-breakpoint
CREATE UNIQUE INDEX "conversions_external_uidx" ON "conversions" USING btree ("organization_id","external_id") WHERE "conversions"."external_id" is not null;