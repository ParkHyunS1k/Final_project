CREATE TABLE "profile_scores" (
	"user_id" text PRIMARY KEY NOT NULL,
	"score" double precision,
	"grade" text NOT NULL,
	"formula_version" text NOT NULL,
	"computed_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "profile_scores" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "public_profile_events" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"action" text NOT NULL,
	"detail" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "public_profile_events" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "public_profiles" (
	"user_id" text PRIMARY KEY NOT NULL,
	"handle" text NOT NULL,
	"display_name" text NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"show_github" boolean DEFAULT false NOT NULL,
	"hidden_projects" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"hidden_experiences" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"shown_evidence" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "public_profiles_handle_unique" UNIQUE("handle")
);
--> statement-breakpoint
ALTER TABLE "public_profiles" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE INDEX "idx_profile_scores_rank" ON "profile_scores" USING btree ("formula_version","score");--> statement-breakpoint
CREATE INDEX "idx_public_profile_events_user" ON "public_profile_events" USING btree ("user_id","created_at");