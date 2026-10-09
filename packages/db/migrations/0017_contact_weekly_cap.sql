ALTER TABLE "organizations" ADD COLUMN "contact_weekly_cap" integer;--> statement-breakpoint
ALTER TABLE "organizations" ADD CONSTRAINT "organizations_weekly_cap_chk" CHECK ("contact_weekly_cap" IS NULL OR ("contact_weekly_cap" BETWEEN 1 AND 50));
