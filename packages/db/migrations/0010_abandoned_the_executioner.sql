CREATE TABLE "entitlement_overrides" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"entitlement_key" text NOT NULL,
	"limit_value" bigint,
	"reason" text,
	"set_by_user_id" uuid,
	"set_by_organization_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "plan_entitlements" (
	"plan_key" text NOT NULL,
	"entitlement_key" text NOT NULL,
	"limit_value" bigint,
	CONSTRAINT "plan_entitlements_plan_key_entitlement_key_pk" PRIMARY KEY("plan_key","entitlement_key")
);
--> statement-breakpoint
CREATE TABLE "plans" (
	"key" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"is_public" boolean DEFAULT true NOT NULL,
	"sort_order" bigint DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "subscriptions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"plan_key" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"source" text DEFAULT 'manual' NOT NULL,
	"sponsor_organization_id" uuid,
	"note" text,
	"updated_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "subscriptions_organization_id_unique" UNIQUE("organization_id"),
	CONSTRAINT "subscriptions_status_check" CHECK ("subscriptions"."status" in ('active','trialing','paused','canceled')),
	CONSTRAINT "subscriptions_source_check" CHECK ("subscriptions"."source" in ('manual','sponsored','stripe'))
);
--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "suspended_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "suspended_reason" text;--> statement-breakpoint
ALTER TABLE "entitlement_overrides" ADD CONSTRAINT "entitlement_overrides_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entitlement_overrides" ADD CONSTRAINT "entitlement_overrides_set_by_user_id_users_id_fk" FOREIGN KEY ("set_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entitlement_overrides" ADD CONSTRAINT "entitlement_overrides_set_by_organization_id_organizations_id_fk" FOREIGN KEY ("set_by_organization_id") REFERENCES "public"."organizations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plan_entitlements" ADD CONSTRAINT "plan_entitlements_plan_key_plans_key_fk" FOREIGN KEY ("plan_key") REFERENCES "public"."plans"("key") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_plan_key_plans_key_fk" FOREIGN KEY ("plan_key") REFERENCES "public"."plans"("key") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_sponsor_organization_id_organizations_id_fk" FOREIGN KEY ("sponsor_organization_id") REFERENCES "public"."organizations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_updated_by_user_id_users_id_fk" FOREIGN KEY ("updated_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "entitlement_overrides_uidx" ON "entitlement_overrides" USING btree ("organization_id","entitlement_key");--> statement-breakpoint
CREATE INDEX "subscriptions_sponsor_idx" ON "subscriptions" USING btree ("sponsor_organization_id");
--> statement-breakpoint
-- Seed plans. Numbers are a first proposal (see docs/MAILORY_OPEN_ITEMS.md); a missing row means 0 (fail closed), NULL means unlimited.
INSERT INTO "plans" ("key","name","is_public","sort_order") VALUES
  ('free','Ücretsiz',true,10),('starter','Başlangıç',true,20),('growth','Büyüme',true,30),
  ('pro','Pro',true,40),('enterprise','Kurumsal',false,50),('btm_sponsored','BTM Sponsorlu',false,60);
--> statement-breakpoint
INSERT INTO "plan_entitlements" ("plan_key","entitlement_key","limit_value") VALUES
  ('free','contacts',500),('free','emails_per_month',1000),('free','members',2),('free','automations',1),('free','ai_credits',20),('free','storage_mb',50),('free','api_requests',0),
  ('starter','contacts',2500),('starter','emails_per_month',10000),('starter','members',3),('starter','automations',3),('starter','ai_credits',100),('starter','storage_mb',200),('starter','api_requests',1000),
  ('growth','contacts',10000),('growth','emails_per_month',50000),('growth','members',10),('growth','automations',10),('growth','ai_credits',500),('growth','storage_mb',1000),('growth','api_requests',10000),
  ('pro','contacts',50000),('pro','emails_per_month',250000),('pro','members',25),('pro','automations',50),('pro','ai_credits',2000),('pro','storage_mb',5000),('pro','api_requests',100000),
  ('enterprise','contacts',NULL),('enterprise','emails_per_month',NULL),('enterprise','members',NULL),('enterprise','automations',NULL),('enterprise','ai_credits',NULL),('enterprise','storage_mb',NULL),('enterprise','api_requests',NULL),
  ('btm_sponsored','contacts',5000),('btm_sponsored','emails_per_month',15000),('btm_sponsored','members',5),('btm_sponsored','automations',5),('btm_sponsored','ai_credits',100),('btm_sponsored','storage_mb',200),('btm_sponsored','api_requests',0);

