-- Add contacts table for persistent contact storage
CREATE TABLE IF NOT EXISTS contacts (
  id TEXT PRIMARY KEY,
  senderId TEXT NOT NULL REFERENCES senders(id),
  name TEXT NOT NULL,
  phoneNumber TEXT NOT NULL,
  originalInput TEXT,
  preferredFormat TEXT,
  category TEXT NOT NULL DEFAULT 'friend',
  confidence INTEGER NOT NULL DEFAULT 50,
  lastContactedAt INTEGER,
  createdAt INTEGER NOT NULL DEFAULT (unixepoch()),
  updatedAt INTEGER NOT NULL DEFAULT (unixepoch())
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS contacts_sender_idx ON contacts(senderId);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS contacts_phoneNumber_idx ON contacts(phoneNumber);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS contacts_sender_phone_idx ON contacts(senderId, phoneNumber);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS contacts_createdAt_idx ON contacts(createdAt);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS contacts_updatedAt_idx ON contacts(updatedAt);
