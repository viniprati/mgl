import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const users = sqliteTable("users", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  cpf: text("cpf").notNull().unique(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  phone: text("phone").notNull(),
  role: text("role").notNull(),
  passwordHash: text("password_hash").notNull(),
  active: integer("active").notNull().default(1),
  createdAt: text("created_at").notNull(),
});

export const sessions = sqliteTable("sessions", {
  id: text("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => users.id),
  expiresAt: text("expires_at").notNull(),
});

export const loginAttempts = sqliteTable("login_attempts", {
  key: text("key").primaryKey(),
  count: integer("count").notNull().default(0),
  lastAt: text("last_at").notNull(),
});

export const properties = sqliteTable("properties", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  title: text("title").notNull(),
  city: text("city").notNull(),
  state: text("state").notNull(),
  neighborhood: text("neighborhood").notNull(),
  type: text("type").notNull(),
  price: integer("price").notNull(),
  area: integer("area").notNull(),
  bedrooms: integer("bedrooms").notNull(),
  parking: integer("parking").notNull(),
  description: text("description").notNull(),
  imageUrl: text("image_url"),
  status: text("status").notNull().default("disponivel"),
  brokerId: integer("broker_id").references(() => users.id),
  createdAt: text("created_at").notNull(),
});

export const deals = sqliteTable("deals", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  propertyId: integer("property_id").notNull().references(() => properties.id),
  brokerId: integer("broker_id").notNull().references(() => users.id),
  clientName: text("client_name").notNull(),
  clientPhone: text("client_phone").notNull(),
  stage: text("stage").notNull().default("contato"),
  notes: text("notes").notNull().default(""),
  createdAt: text("created_at").notNull(),
});

export const payments = sqliteTable("payments", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  dealId: integer("deal_id").notNull().references(() => deals.id),
  amount: integer("amount").notNull(),
  dueDate: text("due_date").notNull(),
  paidAt: text("paid_at"),
  note: text("note").notNull().default(""),
});

export const ownerContacts = sqliteTable("owner_contacts", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  phone: text("phone").notNull(),
  email: text("email").notNull(),
  city: text("city").notNull(),
  message: text("message").notNull(),
  status: text("status").notNull().default("novo"),
  createdAt: text("created_at").notNull(),
});

export const socialLinks = sqliteTable("social_links", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  label: text("label").notNull(),
  url: text("url").notNull(),
});
