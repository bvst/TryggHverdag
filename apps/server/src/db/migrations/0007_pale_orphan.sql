ALTER TYPE "public"."message_kind" ADD VALUE 'NO_RESPONDER';--> statement-breakpoint
ALTER TABLE "outbox" DROP CONSTRAINT "outbox_alert_id_recipient_id_kind_unique";--> statement-breakpoint
ALTER TABLE "outbox" ALTER COLUMN "alert_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "alerts" ADD COLUMN "round" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "outbox" ADD COLUMN "journey_id" uuid;--> statement-breakpoint
ALTER TABLE "outbox" ADD COLUMN "round" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "outbox" ADD CONSTRAINT "outbox_journey_id_journeys_id_fk" FOREIGN KEY ("journey_id") REFERENCES "public"."journeys"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outbox" ADD CONSTRAINT "outbox_alert_id_recipient_id_kind_round_unique" UNIQUE("alert_id","recipient_id","kind","round");--> statement-breakpoint
ALTER TABLE "alerts" ADD CONSTRAINT "alerts_round_check" CHECK ("alerts"."round" >= 1);--> statement-breakpoint
ALTER TABLE "outbox" ADD CONSTRAINT "outbox_alert_id_journey_id_check" CHECK (num_nonnulls("outbox"."alert_id", "outbox"."journey_id") = 1);--> statement-breakpoint
ALTER TABLE "outbox" ADD CONSTRAINT "outbox_round_check" CHECK ("outbox"."round" >= 1);