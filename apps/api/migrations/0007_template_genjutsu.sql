-- Vidéos à refaire par Genjutsu (Higgsfield) : la vidéo du modèle sert elle-même de source ; l'utilisateur n'ajoute que ses photos.
-- Une ligne par modèle concerné (templates.id) ; templates.model_id porte l'outil (motion-transfer ou object-swap), templates.plans '[]'.
-- La source et la consigne restent côté serveur : l'application ne reçoit que l'outil, la durée et les rôles.
CREATE TABLE IF NOT EXISTS template_genjutsu (
  template_id TEXT PRIMARY KEY,
  tool        TEXT NOT NULL,                -- outil du catalogue : motion-transfer | object-swap
  source_key  TEXT NOT NULL,                -- clé R2 de la vidéo source (originale coupée, 720p ou plus, servie par /files/)
  secs        REAL NOT NULL,                -- durée de la source : fixe le prix (facturé à la seconde)
  prompt      TEXT NOT NULL,                -- consigne envoyée à Genjutsu (qui est qui, visages, vêtements…)
  roles       TEXT NOT NULL                 -- JSON : [« Personne A, au centre », …], une photo par rôle, dans cet ordre
);
