-- Photo de profil des utilisateurs (claim `picture` du jeton de session Clerk : {{user.image_url}}), pour l'administration.
-- Table à part plutôt qu'une colonne de `users` : ALTER TABLE … ADD COLUMN ne se rejoue pas, et chaque migration doit pouvoir l'être.
-- Une ligne par compte dont le jeton porte une adresse https valide ; jamais effacée par un jeton qui n'en porte pas.
CREATE TABLE IF NOT EXISTS user_avatars (
  user_id    TEXT PRIMARY KEY,          -- users.id
  url        TEXT NOT NULL,             -- https, 500 caractères au plus
  updated_at INTEGER NOT NULL           -- millisecondes
);
