ALTER TABLE "documents" ADD COLUMN "thing_id" uuid;--> statement-breakpoint
CREATE INDEX "documents_thing_id_idx" ON "documents" USING btree ("thing_id") WHERE "documents"."deleted_at" is null;