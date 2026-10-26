-- Vidéos à refaire (Modèles) : une vidéo d'exemple et les réglages du générateur de vidéos qui la reproduisent. Les fichiers sont dans
-- R2 (bucket des fichiers) sous templates/<id>/ ; l'API les sert par /files/templates/…
CREATE TABLE IF NOT EXISTS templates (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  category    TEXT NOT NULL,                -- regroupement à l'écran (pub, produit, fête…)
  video_key   TEXT NOT NULL,                -- clé R2 de la vidéo d'exemple
  poster_key  TEXT,                         -- clé R2 de l'image montrée avant la lecture
  model_id    TEXT NOT NULL,                -- modèle du générateur de vidéos (catalogue)
  plans       TEXT NOT NULL,                -- JSON : [{ text, dur }], un plan ou plusieurs
  resolution  TEXT,
  ratio       TEXT,
  sound       INTEGER NOT NULL DEFAULT 1,
  photo       TEXT,                         -- ce que l'utilisateur doit fournir comme image de départ (libellé), ou NULL : texte seul
  sort        INTEGER NOT NULL DEFAULT 0,
  published   INTEGER NOT NULL DEFAULT 1,
  created_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS templates_published ON templates (published, sort);
