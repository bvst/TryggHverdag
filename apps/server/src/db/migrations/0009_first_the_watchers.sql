CREATE TYPE "public"."audit_action" AS ENUM('GROUP_CREATED', 'INVITATION_CREATED', 'MEMBER_REMOVED');--> statement-breakpoint
CREATE TYPE "public"."membership_role" AS ENUM('ADMIN', 'MEMBER');--> statement-breakpoint
CREATE TABLE "audit_log" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "audit_log_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"actor_id" uuid,
	"action" "audit_action" NOT NULL,
	"subject_id" uuid
);
--> statement-breakpoint
CREATE TABLE "groups" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "invitations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"group_id" uuid NOT NULL,
	"code_hash" text NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"used_by" uuid,
	"join_key_hash" text,
	CONSTRAINT "invitations_code_hash_unique" UNIQUE("code_hash"),
	CONSTRAINT "invitations_expires_at_check" CHECK ("invitations"."expires_at" > "invitations"."created_at"),
	CONSTRAINT "invitations_used_check" CHECK (num_nulls("invitations"."used_at", "invitations"."used_by", "invitations"."join_key_hash") in (0, 3))
);
--> statement-breakpoint
CREATE TABLE "memberships" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"group_id" uuid NOT NULL,
	"role" "membership_role" NOT NULL,
	"display_name" text NOT NULL,
	"joined_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "memberships_display_name_check" CHECK (char_length(btrim("memberships"."display_name")) between 1 and 40 and "memberships"."display_name" !~ '[\u0001-\u001f\u007f-\u009f]'),
	CONSTRAINT "memberships_not_the_canary_check" CHECK ("memberships"."user_id" not in ('6567904a-e65e-4f15-961f-bea85e86fb34'::uuid, 'c7c43147-c1af-49e2-afe2-3a7aeb06717a'::uuid))
);
--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_group_id_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."groups"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_used_by_users_id_fk" FOREIGN KEY ("used_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_group_id_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."groups"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "groups_one_group" ON "groups" USING btree ((true));--> statement-breakpoint
CREATE UNIQUE INDEX "memberships_one_admin_per_group" ON "memberships" USING btree ("group_id") WHERE "memberships"."role" = 'ADMIN';