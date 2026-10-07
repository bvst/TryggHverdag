ALTER TYPE "public"."message_kind" ADD VALUE 'LOST_CONTACT_SMS';--> statement-breakpoint
ALTER TABLE "alerts" ADD COLUMN "sms_raised_at" timestamp with time zone;