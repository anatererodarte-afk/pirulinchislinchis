import { pgTable, text, jsonb, timestamp } from 'drizzle-orm/pg-core';
export const content = pgTable('birthday_content', {
  id: text().primaryKey(),
  value: jsonb().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});
export const progress = pgTable('birthday_progress', {
  id: text().primaryKey(),
  value: jsonb().notNull(),
  first: timestamp().defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});
