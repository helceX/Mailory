import { sql } from "drizzle-orm";
import {
  pgTable,
  uuid,
  text,
  timestamp,
  uniqueIndex,
  check,
} from "drizzle-orm/pg-core";
import { campaigns } from "./campaigns";
import { contacts } from "./audience";
import { organizations } from "./organizations";
export const campaignImpactMembers = pgTable(
  "campaign_impact_members",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    campaignId: uuid("campaign_id")
      .notNull()
      .references(() => campaigns.id, { onDelete: "cascade" }),
    contactId: uuid("contact_id").references(() => contacts.id, {
      onDelete: "set null",
    }),
    email: text("email").notNull(),
    arm: text("arm").notNull(),
    assignedAt: timestamp("assigned_at", { withTimezone: true }).notNull(),
  },
  (t) => [
    uniqueIndex("impact_campaign_email_uidx").on(t.campaignId, t.email),
    check("impact_arm_check", sql`${t.arm} in ('treatment','control')`),
  ],
);
