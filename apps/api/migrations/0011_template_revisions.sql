-- Version d'un modèle : chaque enregistrement l'augmente de 1. La publication et l'enregistrement n'écrivent que si la version (et,
-- pour l'enregistrement, l'état publié) est encore celle qu'ils ont contrôlée ; sinon 409 `conflict` (modifié entre-temps).
CREATE TABLE IF NOT EXISTS template_revisions (
  template_id TEXT PRIMARY KEY,             -- templates.id
  rev         INTEGER NOT NULL DEFAULT 0
);
