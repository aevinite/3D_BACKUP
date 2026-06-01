-- How many tables the restaurant has (drives the editor's table floor-map).
ALTER TABLE settings ADD COLUMN IF NOT EXISTS table_count INTEGER NOT NULL DEFAULT 12;
