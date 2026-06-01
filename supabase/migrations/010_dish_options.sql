-- Per-dish customization options the owner defines in the editor and the guest
-- picks when ordering. Shape: an array of option groups, e.g.
-- [ { "name": "Size", "type": "single", "choices": [ {"label":"Small","price":0}, {"label":"Large","price":50} ] },
--   { "name": "Extras", "type": "multi", "choices": [ {"label":"Extra shot","price":40} ] } ]
ALTER TABLE menu_items ADD COLUMN IF NOT EXISTS options JSONB NOT NULL DEFAULT '[]';
