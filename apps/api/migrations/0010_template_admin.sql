-- Administration des vidéos à refaire (Modèles) : les entrées de chaque modèle et le journal des modifications.
-- Tables à part (jamais ALTER TABLE : chaque migration doit pouvoir se rejouer). `templates` et `template_genjutsu` ne changent pas.
-- Entrées d'un modèle du générateur de vidéos (voir packages/catalog/src/templateSlots.js) : une ligne par entrée, dans l'ordre `idx`.
-- Un modèle sans ligne garde l'ancienne forme (colonnes `image` et `photo` de `templates`, voir legacyInputs).
CREATE TABLE IF NOT EXISTS template_inputs (
  template_id TEXT NOT NULL,                -- templates.id
  idx         INTEGER NOT NULL,             -- ordre d'affichage et de numérotation (@Element1, @Image1…)
  slot        TEXT NOT NULL CHECK (slot IN ('start','end','element','reference','audio','source')),
  kind        TEXT NOT NULL CHECK (kind IN ('image','video','audio')),
  mode        TEXT NOT NULL CHECK (mode IN ('fixed','user','generated')),
  file_key    TEXT,                         -- fixed : clé R2 sous templates/
  label       TEXT,                         -- user : ce qu'on demande à l'utilisateur
  optional    INTEGER NOT NULL DEFAULT 0,   -- user : 1 s'il peut s'en passer
  prompt      TEXT,                         -- generated : consigne de Krea 3
  from_idx    INTEGER,                      -- generated : entrée `source` dont la photo sert de départ
  PRIMARY KEY (template_id, idx)
);
-- Journal : qui a créé, modifié, publié, retiré, réordonné, déposé un fichier ou supprimé un modèle (template_id '*' pour l'ordre).
CREATE TABLE IF NOT EXISTS template_events (
  id          TEXT PRIMARY KEY,
  at          INTEGER NOT NULL,             -- millisecondes
  actor       TEXT NOT NULL,                -- compte Clerk de l'administrateur
  template_id TEXT NOT NULL,
  action      TEXT NOT NULL CHECK (action IN ('create','update','publish','unpublish','order','upload','delete')),
  detail      TEXT                          -- JSON facultatif
);
CREATE INDEX IF NOT EXISTS template_events_tpl ON template_events (template_id, at);
