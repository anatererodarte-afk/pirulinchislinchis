CREATE TABLE "birthday_content" (
	"id" text PRIMARY KEY,
	"value" jsonb NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "birthday_progress" (
	"id" text PRIMARY KEY,
	"value" jsonb NOT NULL,
	"first" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
