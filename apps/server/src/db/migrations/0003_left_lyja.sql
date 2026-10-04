CREATE TYPE "public"."alert_state" AS ENUM('OPEN', 'ESCALATED', 'ACKNOWLEDGED', 'RESOLVED');--> statement-breakpoint
CREATE TYPE "public"."message_kind" AS ENUM('LOST_CONTACT');--> statement-breakpoint
CREATE TABLE "alerts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"journey_id" uuid NOT NULL,
	"state" "alert_state" NOT NULL,
	"opened_at" timestamp with time zone NOT NULL,
	"silent_since" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "outbox" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"alert_id" uuid NOT NULL,
	"recipient_id" uuid NOT NULL,
	"kind" "message_kind" NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"next_attempt_at" timestamp with time zone NOT NULL,
	"sent_at" timestamp with time zone,
	"last_failure" text,
	CONSTRAINT "outbox_alert_id_recipient_id_kind_unique" UNIQUE("alert_id","recipient_id","kind"),
	CONSTRAINT "outbox_attempts_check" CHECK ("outbox"."attempts" >= 0),
	CONSTRAINT "outbox_last_failure_check" CHECK ("outbox"."last_failure" in ('NO_TARGET', 'REFUSED', 'UNAVAILABLE', 'NOT_CONFIGURED'))
);
--> statement-breakpoint
ALTER TABLE "alerts" ADD CONSTRAINT "alerts_journey_id_journeys_id_fk" FOREIGN KEY ("journey_id") REFERENCES "public"."journeys"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outbox" ADD CONSTRAINT "outbox_alert_id_alerts_id_fk" FOREIGN KEY ("alert_id") REFERENCES "public"."alerts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outbox" ADD CONSTRAINT "outbox_recipient_id_users_id_fk" FOREIGN KEY ("recipient_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "alerts_one_unresolved_per_journey" ON "alerts" USING btree ("journey_id") WHERE "alerts"."state" <> 'RESOLVED';