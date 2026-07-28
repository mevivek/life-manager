CREATE TYPE "public"."doc_type" AS ENUM('identity', 'financial', 'legal', 'warranty', 'receipt', 'certificate', 'other');--> statement-breakpoint
CREATE TYPE "public"."reminder_channel" AS ENUM('web_push', 'email', 'fcm', 'apns');--> statement-breakpoint
CREATE TABLE "document_files" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"space_id" uuid NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"document_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"storage_key" text NOT NULL,
	"mime" text NOT NULL,
	"size_bytes" bigint NOT NULL,
	"sha256" text,
	"is_primary" boolean DEFAULT false NOT NULL,
	"uploaded_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"space_id" uuid NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"title" text NOT NULL,
	"doc_type" "doc_type" DEFAULT 'other' NOT NULL,
	"issuer" text,
	"identifier_last4" text,
	"issued_on" date,
	"expires_on" date,
	"country" char(2),
	"notes" text,
	"tags" text[] DEFAULT '{}'::text[] NOT NULL,
	"custom_attrs" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"search_vector" "tsvector" GENERATED ALWAYS AS (setweight(to_tsvector('english', coalesce(title, '')), 'A') ||
          setweight(to_tsvector('english', coalesce(issuer, '')), 'B') ||
          setweight(to_tsvector('english', coalesce(notes, '')), 'C') ||
          array_to_tsvector(tags)) STORED
);
--> statement-breakpoint
CREATE TABLE "push_subscriptions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"space_id" uuid NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"endpoint" text NOT NULL,
	"p256dh" text NOT NULL,
	"auth" text NOT NULL,
	"expired_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "reminders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"space_id" uuid NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"entity_type" text NOT NULL,
	"entity_id" uuid NOT NULL,
	"due_on" date NOT NULL,
	"lead_days" integer DEFAULT 0 NOT NULL,
	"channel" "reminder_channel" DEFAULT 'web_push' NOT NULL,
	"sent_at" timestamp with time zone,
	"dismissed_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "document_files" ADD CONSTRAINT "document_files_space_id_spaces_id_fk" FOREIGN KEY ("space_id") REFERENCES "public"."spaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_files" ADD CONSTRAINT "document_files_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_files" ADD CONSTRAINT "document_files_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_space_id_spaces_id_fk" FOREIGN KEY ("space_id") REFERENCES "public"."spaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "push_subscriptions" ADD CONSTRAINT "push_subscriptions_space_id_spaces_id_fk" FOREIGN KEY ("space_id") REFERENCES "public"."spaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "push_subscriptions" ADD CONSTRAINT "push_subscriptions_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reminders" ADD CONSTRAINT "reminders_space_id_spaces_id_fk" FOREIGN KEY ("space_id") REFERENCES "public"."spaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reminders" ADD CONSTRAINT "reminders_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "document_files_space_id_idx" ON "document_files" USING btree ("space_id") WHERE "document_files"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX "document_files_document_id_idx" ON "document_files" USING btree ("document_id");--> statement-breakpoint
CREATE UNIQUE INDEX "document_files_document_id_version_key" ON "document_files" USING btree ("document_id","version");--> statement-breakpoint
CREATE UNIQUE INDEX "document_files_one_primary_key" ON "document_files" USING btree ("document_id") WHERE "document_files"."is_primary" and "document_files"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX "document_files_unconfirmed_idx" ON "document_files" USING btree ("created_at") WHERE "document_files"."uploaded_at" is null and "document_files"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX "documents_space_id_idx" ON "documents" USING btree ("space_id") WHERE "documents"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX "documents_space_id_expires_on_idx" ON "documents" USING btree ("space_id","expires_on") WHERE "documents"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX "documents_search_vector_idx" ON "documents" USING gin ("search_vector");--> statement-breakpoint
CREATE INDEX "documents_tags_idx" ON "documents" USING gin ("tags");--> statement-breakpoint
CREATE INDEX "push_subscriptions_space_id_idx" ON "push_subscriptions" USING btree ("space_id") WHERE "push_subscriptions"."deleted_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "push_subscriptions_endpoint_key" ON "push_subscriptions" USING btree ("endpoint");--> statement-breakpoint
CREATE INDEX "reminders_space_id_idx" ON "reminders" USING btree ("space_id") WHERE "reminders"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX "reminders_due_idx" ON "reminders" USING btree ("due_on") WHERE "reminders"."sent_at" is null and "reminders"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX "reminders_entity_idx" ON "reminders" USING btree ("entity_type","entity_id");