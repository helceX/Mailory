-- Defense in depth for tenant isolation (docs/MAILORY_DECISIONS.md D-089).
-- The service layer already verifies that every referenced id belongs to the caller's organization. These composite
-- foreign keys make the DATABASE refuse a cross-tenant reference even if a future code path forgets: a child row can
-- only point at a parent row of the SAME organization. They are ADDITIONAL to the existing single-column FKs (which
-- keep their ON DELETE behaviour); nullable child columns are unaffected (MATCH SIMPLE skips NULLs).
-- Not modelled in the drizzle schema on purpose (drizzle-kit would not understand them); do not drop them in later diffs.
--> statement-breakpoint
ALTER TABLE "lists" ADD CONSTRAINT "lists_id_org_uq" UNIQUE ("id", "organization_id");
--> statement-breakpoint
ALTER TABLE "contacts" ADD CONSTRAINT "contacts_id_org_uq" UNIQUE ("id", "organization_id");
--> statement-breakpoint
ALTER TABLE "tags" ADD CONSTRAINT "tags_id_org_uq" UNIQUE ("id", "organization_id");
--> statement-breakpoint
ALTER TABLE "sender_identities" ADD CONSTRAINT "sender_identities_id_org_uq" UNIQUE ("id", "organization_id");
--> statement-breakpoint
ALTER TABLE "templates" ADD CONSTRAINT "templates_id_org_uq" UNIQUE ("id", "organization_id");
--> statement-breakpoint
ALTER TABLE "template_versions" ADD CONSTRAINT "template_versions_id_org_uq" UNIQUE ("id", "organization_id");
--> statement-breakpoint
ALTER TABLE "automations" ADD CONSTRAINT "automations_id_org_uq" UNIQUE ("id", "organization_id");
--> statement-breakpoint
ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_id_org_uq" UNIQUE ("id", "organization_id");
--> statement-breakpoint
ALTER TABLE "campaign_recipients" ADD CONSTRAINT "campaign_recipients_id_org_uq" UNIQUE ("id", "organization_id");
--> statement-breakpoint
ALTER TABLE "campaign_links" ADD CONSTRAINT "campaign_links_id_org_uq" UNIQUE ("id", "organization_id");
--> statement-breakpoint
ALTER TABLE "assets" ADD CONSTRAINT "assets_id_org_uq" UNIQUE ("id", "organization_id");
--> statement-breakpoint
ALTER TABLE "list_contacts" ADD CONSTRAINT "list_contacts_list_id_org_fk" FOREIGN KEY ("list_id", "organization_id") REFERENCES "lists" ("id", "organization_id");
--> statement-breakpoint
ALTER TABLE "list_contacts" ADD CONSTRAINT "list_contacts_contact_id_org_fk" FOREIGN KEY ("contact_id", "organization_id") REFERENCES "contacts" ("id", "organization_id");
--> statement-breakpoint
ALTER TABLE "contact_tags" ADD CONSTRAINT "contact_tags_tag_id_org_fk" FOREIGN KEY ("tag_id", "organization_id") REFERENCES "tags" ("id", "organization_id");
--> statement-breakpoint
ALTER TABLE "contact_tags" ADD CONSTRAINT "contact_tags_contact_id_org_fk" FOREIGN KEY ("contact_id", "organization_id") REFERENCES "contacts" ("id", "organization_id");
--> statement-breakpoint
ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_sender_identity_id_org_fk" FOREIGN KEY ("sender_identity_id", "organization_id") REFERENCES "sender_identities" ("id", "organization_id");
--> statement-breakpoint
ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_template_id_org_fk" FOREIGN KEY ("template_id", "organization_id") REFERENCES "templates" ("id", "organization_id");
--> statement-breakpoint
ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_template_version_id_org_fk" FOREIGN KEY ("template_version_id", "organization_id") REFERENCES "template_versions" ("id", "organization_id");
--> statement-breakpoint
ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_automation_id_org_fk" FOREIGN KEY ("automation_id", "organization_id") REFERENCES "automations" ("id", "organization_id");
--> statement-breakpoint
ALTER TABLE "campaign_recipients" ADD CONSTRAINT "campaign_recipients_campaign_id_org_fk" FOREIGN KEY ("campaign_id", "organization_id") REFERENCES "campaigns" ("id", "organization_id");
--> statement-breakpoint
ALTER TABLE "campaign_recipients" ADD CONSTRAINT "campaign_recipients_contact_id_org_fk" FOREIGN KEY ("contact_id", "organization_id") REFERENCES "contacts" ("id", "organization_id");
--> statement-breakpoint
ALTER TABLE "campaign_links" ADD CONSTRAINT "campaign_links_campaign_id_org_fk" FOREIGN KEY ("campaign_id", "organization_id") REFERENCES "campaigns" ("id", "organization_id");
--> statement-breakpoint
ALTER TABLE "tracking_events" ADD CONSTRAINT "tracking_events_campaign_id_org_fk" FOREIGN KEY ("campaign_id", "organization_id") REFERENCES "campaigns" ("id", "organization_id");
--> statement-breakpoint
ALTER TABLE "tracking_events" ADD CONSTRAINT "tracking_events_recipient_id_org_fk" FOREIGN KEY ("recipient_id", "organization_id") REFERENCES "campaign_recipients" ("id", "organization_id");
--> statement-breakpoint
ALTER TABLE "tracking_events" ADD CONSTRAINT "tracking_events_link_id_org_fk" FOREIGN KEY ("link_id", "organization_id") REFERENCES "campaign_links" ("id", "organization_id");
--> statement-breakpoint
ALTER TABLE "automation_enrollments" ADD CONSTRAINT "automation_enrollments_automation_id_org_fk" FOREIGN KEY ("automation_id", "organization_id") REFERENCES "automations" ("id", "organization_id");
--> statement-breakpoint
ALTER TABLE "automation_enrollments" ADD CONSTRAINT "automation_enrollments_contact_id_org_fk" FOREIGN KEY ("contact_id", "organization_id") REFERENCES "contacts" ("id", "organization_id");
--> statement-breakpoint
ALTER TABLE "automation_enrollments" ADD CONSTRAINT "automation_enrollments_last_recipient_id_org_fk" FOREIGN KEY ("last_recipient_id", "organization_id") REFERENCES "campaign_recipients" ("id", "organization_id");
--> statement-breakpoint
ALTER TABLE "template_versions" ADD CONSTRAINT "template_versions_template_id_org_fk" FOREIGN KEY ("template_id", "organization_id") REFERENCES "templates" ("id", "organization_id");
--> statement-breakpoint
ALTER TABLE "brand_kits" ADD CONSTRAINT "brand_kits_logo_asset_id_org_fk" FOREIGN KEY ("logo_asset_id", "organization_id") REFERENCES "assets" ("id", "organization_id");
