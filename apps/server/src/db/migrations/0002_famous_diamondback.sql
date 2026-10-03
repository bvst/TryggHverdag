CREATE TABLE "heartbeats" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "heartbeats_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"journey_id" uuid NOT NULL,
	"event_id" text NOT NULL,
	"received_at" timestamp with time zone NOT NULL,
	"battery_level" double precision,
	CONSTRAINT "heartbeats_journey_id_event_id_unique" UNIQUE("journey_id","event_id"),
	CONSTRAINT "heartbeats_event_id_check" CHECK ("heartbeats"."event_id" ~ '^[A-Za-z0-9-]{1,64}$'),
	CONSTRAINT "heartbeats_battery_level_check" CHECK ("heartbeats"."battery_level" >= 0 and "heartbeats"."battery_level" <= 1)
);
--> statement-breakpoint
CREATE TABLE "positions" (
	"heartbeat_id" bigint PRIMARY KEY NOT NULL,
	"latitude" double precision NOT NULL,
	"longitude" double precision NOT NULL,
	"accuracy_m" double precision NOT NULL,
	"recorded_at" timestamp with time zone NOT NULL,
	CONSTRAINT "positions_latitude_check" CHECK ("positions"."latitude" >= -90 and "positions"."latitude" <= 90),
	CONSTRAINT "positions_longitude_check" CHECK ("positions"."longitude" >= -180 and "positions"."longitude" <= 180),
	CONSTRAINT "positions_accuracy_m_check" CHECK ("positions"."accuracy_m" >= 0 and "positions"."accuracy_m" < 'Infinity'::double precision)
);
--> statement-breakpoint
ALTER TABLE "journeys" ADD COLUMN "device_id" uuid NOT NULL;--> statement-breakpoint
ALTER TABLE "journeys" ADD COLUMN "last_heartbeat_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "heartbeats" ADD CONSTRAINT "heartbeats_journey_id_journeys_id_fk" FOREIGN KEY ("journey_id") REFERENCES "public"."journeys"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "positions" ADD CONSTRAINT "positions_heartbeat_id_heartbeats_id_fk" FOREIGN KEY ("heartbeat_id") REFERENCES "public"."heartbeats"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "heartbeats_latest_index" ON "heartbeats" USING btree ("journey_id","received_at" DESC NULLS LAST,"id" DESC NULLS LAST);--> statement-breakpoint
ALTER TABLE "journeys" ADD CONSTRAINT "journeys_device_id_devices_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."devices"("id") ON DELETE no action ON UPDATE no action;