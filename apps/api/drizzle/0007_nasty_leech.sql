CREATE TYPE "public"."thing_kind" AS ENUM('phone', 'laptop', 'tablet', 'vehicle', 'appliance', 'av', 'furniture', 'tool', 'valuable', 'other');--> statement-breakpoint
CREATE TYPE "public"."thing_ownership" AS ENUM('here', 'lent', 'gone');--> statement-breakpoint
CREATE TABLE "thing_photos" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"space_id" uuid NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"thing_id" uuid NOT NULL,
	"storage_key" text NOT NULL,
	"mime" text NOT NULL,
	"size_bytes" bigint NOT NULL,
	"sha256" text,
	"is_hero" boolean DEFAULT false NOT NULL,
	"uploaded_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "thing_services" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"space_id" uuid NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"thing_id" uuid NOT NULL,
	"serviced_on" date NOT NULL,
	"cost" numeric(19, 4),
	"currency" char(3),
	"provider" text,
	"notes" text
);
--> statement-breakpoint
CREATE TABLE "things" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"space_id" uuid NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	"name" text NOT NULL,
	"kind" "thing_kind" DEFAULT 'other' NOT NULL,
	"brand" text,
	"model" text,
	"serial" text,
	"serial_last4" text,
	"purchased_on" date,
	"price" numeric(19, 4),
	"currency" char(3),
	"warranty_ends_on" date,
	"service_every_months" integer,
	"service_due_on" date,
	"kept_at" text,
	"holder" text,
	"relation" text,
	"ownership" "thing_ownership" DEFAULT 'here' NOT NULL,
	"ownership_who" text,
	"ownership_since" date,
	"notes" text,
	"search_vector" "tsvector" GENERATED ALWAYS AS (setweight(to_tsvector('english', coalesce(name, '')), 'A') ||
          setweight(to_tsvector('english', coalesce(brand, '')), 'B') ||
          setweight(to_tsvector('english', coalesce(model, '')), 'B') ||
          setweight(to_tsvector('english', coalesce(notes, '')), 'C') ||
          setweight(to_tsvector('english', coalesce(kept_at, '')), 'C')) STORED
);
--> statement-breakpoint
ALTER TABLE "thing_photos" ADD CONSTRAINT "thing_photos_space_id_spaces_id_fk" FOREIGN KEY ("space_id") REFERENCES "public"."spaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "thing_photos" ADD CONSTRAINT "thing_photos_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "thing_photos" ADD CONSTRAINT "thing_photos_thing_id_things_id_fk" FOREIGN KEY ("thing_id") REFERENCES "public"."things"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "thing_services" ADD CONSTRAINT "thing_services_space_id_spaces_id_fk" FOREIGN KEY ("space_id") REFERENCES "public"."spaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "thing_services" ADD CONSTRAINT "thing_services_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "thing_services" ADD CONSTRAINT "thing_services_thing_id_things_id_fk" FOREIGN KEY ("thing_id") REFERENCES "public"."things"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "things" ADD CONSTRAINT "things_space_id_spaces_id_fk" FOREIGN KEY ("space_id") REFERENCES "public"."spaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "things" ADD CONSTRAINT "things_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "thing_photos_space_id_idx" ON "thing_photos" USING btree ("space_id") WHERE "thing_photos"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX "thing_photos_thing_id_idx" ON "thing_photos" USING btree ("thing_id");--> statement-breakpoint
CREATE UNIQUE INDEX "thing_photos_one_hero_key" ON "thing_photos" USING btree ("thing_id") WHERE "thing_photos"."is_hero" and "thing_photos"."uploaded_at" is not null and "thing_photos"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX "thing_photos_unconfirmed_idx" ON "thing_photos" USING btree ("created_at") WHERE "thing_photos"."uploaded_at" is null and "thing_photos"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX "thing_services_space_id_idx" ON "thing_services" USING btree ("space_id") WHERE "thing_services"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX "thing_services_thing_id_serviced_on_idx" ON "thing_services" USING btree ("thing_id","serviced_on" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "things_space_id_idx" ON "things" USING btree ("space_id") WHERE "things"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX "things_space_id_warranty_ends_on_idx" ON "things" USING btree ("space_id","warranty_ends_on") WHERE "things"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX "things_space_id_service_due_on_idx" ON "things" USING btree ("space_id","service_due_on") WHERE "things"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX "things_search_vector_idx" ON "things" USING gin ("search_vector");--> statement-breakpoint
-- ─────────────────────────────────────────────────────────────────────────────
-- HAND-ADDED, and the only line in this file drizzle-kit did not generate.
--
-- `documents.thing_id` has existed as an unconstrained uuid since 0006, so a row could in
-- principle hold an id that `things` has never contained — and `things` is empty everywhere this
-- migration is about to run, so ANY non-null value would fail the constraint below. ADR-0023
-- applies migrations on boot, which makes that a production outage rather than a failed build.
--
-- Nothing should be able to have written one (the only writer is the client's link picker, which
-- offers ids from `GET /things` — an endpoint that did not exist), so this is expected to change
-- zero rows. It is here because "expected to change zero rows" and "cannot take the API down" are
-- different claims, and only the second one is worth having.
--
-- `NOT EXISTS` rather than `NOT IN`: `NOT IN` against a subquery yielding a NULL evaluates to
-- UNKNOWN for every row and would quietly match nothing.
UPDATE "documents" SET "thing_id" = NULL
 WHERE "thing_id" IS NOT NULL
   AND NOT EXISTS (SELECT 1 FROM "things" WHERE "things"."id" = "documents"."thing_id");--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_thing_id_things_id_fk" FOREIGN KEY ("thing_id") REFERENCES "public"."things"("id") ON DELETE set null ON UPDATE no action;