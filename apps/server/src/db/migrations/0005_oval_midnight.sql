ALTER TYPE "public"."message_kind" ADD VALUE 'ACKNOWLEDGED';--> statement-breakpoint
ALTER TABLE "alerts" ADD COLUMN "acknowledged_by" uuid;--> statement-breakpoint
ALTER TABLE "alerts" ADD COLUMN "acknowledged_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "alerts" ADD CONSTRAINT "alerts_acknowledged_by_users_id_fk" FOREIGN KEY ("acknowledged_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "alerts" ADD CONSTRAINT "alerts_acknowledged_at_acknowledged_by_check" CHECK (("alerts"."acknowledged_at" is null) = ("alerts"."acknowledged_by" is null));