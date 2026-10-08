CREATE TABLE "billing_profiles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"legal_name" text NOT NULL,
	"tax_office" text NOT NULL,
	"tax_id" text NOT NULL,
	"tax_id_kind" text NOT NULL,
	"address_line" text NOT NULL,
	"district" text DEFAULT '' NOT NULL,
	"city" text NOT NULL,
	"postal_code" text DEFAULT '' NOT NULL,
	"country" text DEFAULT 'TR' NOT NULL,
	"invoice_email" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "billing_profiles_organization_id_unique" UNIQUE("organization_id")
);
--> statement-breakpoint
ALTER TABLE "billing_profiles" ADD CONSTRAINT "billing_profiles_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;