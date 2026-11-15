ALTER TABLE "sprint_checkins" ADD COLUMN "person" integer;--> statement-breakpoint
ALTER TABLE "sprint_checkins" ADD COLUMN "author_person" integer;--> statement-breakpoint
ALTER TABLE "sprint_checkins" ADD COLUMN "done" boolean DEFAULT false NOT NULL;