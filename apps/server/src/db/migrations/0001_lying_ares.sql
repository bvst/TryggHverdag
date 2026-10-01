CREATE TYPE "public"."journey_state" AS ENUM('ACTIVE', 'LOST_CONTACT', 'ENDED');--> statement-breakpoint
CREATE TABLE "devices" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"credential_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "devices_credential_hash_unique" UNIQUE("credential_hash")
);
--> statement-breakpoint
CREATE TABLE "journey_responders" (
	"journey_id" uuid NOT NULL,
	"responder_id" uuid NOT NULL,
	CONSTRAINT "journey_responders_journey_id_responder_id_pk" PRIMARY KEY("journey_id","responder_id")
);
--> statement-breakpoint
CREATE TABLE "journeys" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"walker_id" uuid NOT NULL,
	"state" "journey_state" NOT NULL,
	"started_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "devices" ADD CONSTRAINT "devices_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "journey_responders" ADD CONSTRAINT "journey_responders_journey_id_journeys_id_fk" FOREIGN KEY ("journey_id") REFERENCES "public"."journeys"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "journey_responders" ADD CONSTRAINT "journey_responders_responder_id_users_id_fk" FOREIGN KEY ("responder_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "journeys" ADD CONSTRAINT "journeys_walker_id_users_id_fk" FOREIGN KEY ("walker_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "journeys_one_unended_per_walker" ON "journeys" USING btree ("walker_id") WHERE "journeys"."state" <> 'ENDED';