-- Administration : journal des actions des administrateurs (ADMIN_USER_IDS), compte bloqué, et index des recherches de l'administration.
-- Chaque action d'argent ou de blocage est d'abord décidée par le Durable Object du compte visé ; la ligne est écrite ensuite.
-- `id` est la clé d'idempotence envoyée par l'interface (« adm_<uuid> ») : la même action rejouée n'est ni refaite ni notée deux fois.
CREATE TABLE IF NOT EXISTS admin_actions (
  id     TEXT PRIMARY KEY,
  at     INTEGER NOT NULL,              -- millisecondes
  actor  TEXT NOT NULL,                 -- `sub` Clerk de l'administrateur
  target TEXT NOT NULL,                 -- compte visé (users.id)
  action TEXT NOT NULL CHECK (action IN ('credit', 'debit', 'refund_job', 'cancel_job', 'recheck_topup', 'block', 'unblock')),
  ref    TEXT,                          -- génération ou référence de recharge
  amount REAL,                          -- jetons
  reason TEXT NOT NULL,                 -- motif, obligatoire
  result TEXT                           -- JSON : la réponse rendue à l'administrateur
);
CREATE INDEX IF NOT EXISTS admin_actions_target_at ON admin_actions (target, at);
CREATE INDEX IF NOT EXISTS admin_actions_at ON admin_actions (at);

-- Comptes bloqués : copie pour l'affichage et les listes seulement, le blocage qui fait foi est dans le Durable Object du compte.
-- Table à part plutôt que des colonnes de `users` : ALTER TABLE … ADD COLUMN ne se rejoue pas, et chaque migration doit pouvoir l'être.
-- Une ligne par compte bloqué, supprimée au déblocage.
CREATE TABLE IF NOT EXISTS user_blocks (
  user_id    TEXT PRIMARY KEY,          -- users.id
  blocked_at INTEGER NOT NULL,          -- millisecondes
  reason     TEXT NOT NULL,
  actor      TEXT NOT NULL              -- administrateur
);

CREATE INDEX IF NOT EXISTS users_email ON users (email);
-- Recharges restées ouvertes : statut et date de création (updated_at bouge à chaque lecture de l'interface).
CREATE INDEX IF NOT EXISTS topups_status_created ON topups (status, created_at);
