-- Every customer is equal (docs/MAILORY_DECISIONS.md D-099/D-100): the sponsored plan and sponsorship subscriptions go.
-- Existing sponsored subscriptions fall back to the free plan; no customer data is touched. Partner/hub tables stay in
-- place unused (dropping them is a separate, irreversible step — see OPEN_ITEMS C11).
UPDATE "subscriptions" SET "plan_key" = 'free', "source" = 'manual', "sponsor_organization_id" = NULL WHERE "plan_key" = 'btm_sponsored' OR "source" = 'sponsored';--> statement-breakpoint
DELETE FROM "entitlement_overrides" WHERE "set_by_organization_id" IS NOT NULL;--> statement-breakpoint
DELETE FROM "plan_entitlements" WHERE "plan_key" = 'btm_sponsored';--> statement-breakpoint
DELETE FROM "plans" WHERE "key" = 'btm_sponsored';--> statement-breakpoint
UPDATE "organizations" SET "type" = 'standard', "parent_organization_id" = NULL WHERE "type" <> 'standard' OR "parent_organization_id" IS NOT NULL;
