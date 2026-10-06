CREATE TYPE "public"."alert_resolution" AS ENUM('BACK_IN_CONTACT', 'HOME');--> statement-breakpoint
CREATE TYPE "public"."journey_end_reason" AS ENUM('HOME');--> statement-breakpoint
ALTER TYPE "public"."message_kind" ADD VALUE 'BACK_IN_CONTACT';--> statement-breakpoint
ALTER TYPE "public"."message_kind" ADD VALUE 'HOME';--> statement-breakpoint
ALTER TABLE "alerts" ADD COLUMN "resolved_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "alerts" ADD COLUMN "resolution" "alert_resolution";--> statement-breakpoint
ALTER TABLE "journeys" ADD COLUMN "ended_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "journeys" ADD COLUMN "end_reason" "journey_end_reason";--> statement-breakpoint
ALTER TABLE "outbox" ADD COLUMN "withdrawn_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "alerts" ADD CONSTRAINT "alerts_resolved_at_resolution_check" CHECK (("alerts"."resolved_at" is null) = ("alerts"."resolution" is null));--> statement-breakpoint
ALTER TABLE "journeys" ADD CONSTRAINT "journeys_ended_at_end_reason_check" CHECK (("journeys"."ended_at" is null) = ("journeys"."end_reason" is null));