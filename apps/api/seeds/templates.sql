-- Vidéos à refaire : les premières, à charger dans D1 une fois leurs vidéos déposées dans R2 (bucket studio-files) :
--   pnpm --filter @studio/api exec wrangler d1 execute DB --remote --file seeds/templates.sql -c wrangler.jsonc
-- Rejouable (INSERT OR REPLACE). Chaque vidéo : templates/<id>/video.mp4, aperçu en H.264 720p sans le son (moins de 1,5 Mo),
-- lu par tous les navigateurs (les originaux en HEVC ne le sont pas partout).
-- `plans` : [{ text, dur }] ; `photo` : ce que l'utilisateur ajoute comme image de départ (NULL : texte seul).
INSERT OR REPLACE INTO templates (id, name, category, video_key, model_id, plans, resolution, ratio, sound, photo, sort, published, created_at) VALUES
('explainer-produit', 'Explainer produit', 'produit', 'templates/explainer-produit/video.mp4', 'kling-4',
 '[{"text":"Plan studio sur fond beige uni. Le produit de la photo est posé au centre, puis s''ouvre et ses pièces s''écartent en vue éclatée, flottant dans l''air ; des contours lumineux soulignent les composants, puis tout se referme. Lumière douce, rendu 3D net, caméra qui tourne lentement autour.","dur":12}]',
 '1080p', '16:9', 1, 'Une photo de votre produit', 10, 1, unixepoch() * 1000),
('produit-en-main', 'Produit en main', 'pub', 'templates/produit-en-main/video.mp4', 'flux-3-max',
 '[{"text":"Vidéo verticale façon créatrice de contenu : une jeune femme souriante, face caméra, dans une pièce claire, tient le produit de la photo, le montre de près, le tourne dans ses mains et le présente fièrement. Lumière naturelle, rythme vif, ambiance joyeuse.","dur":8}]',
 '1080p', '9:16', 1, 'Une photo de votre produit', 20, 1, unixepoch() * 1000),
('scene-de-film', 'Scène de film', 'cinema', 'templates/scene-de-film/video.mp4', 'kling-4',
 '[{"text":"Salle de marchés des années 80, écrans de cotations rouges et verts. Le personnage de la photo, chemise bleue et cravate, avance d''un pas décidé entre les bureaux pendant que ses collègues le regardent.","dur":4},{"text":"Il soulève une photocopieuse au-dessus de sa tête et la jette ; les feuilles volent, la salle est figée. Gros plan sur son regard furieux.","dur":4},{"text":"Sur le pont d''un yacht en pleine mer, calme, il boit un expresso au soleil puis contemple le sillage. Ton de comédie, image de cinéma.","dur":4}]',
 '1080p', '16:9', 1, 'Une photo du personnage', 30, 1, unixepoch() * 1000),
('portrait-cinema', 'Portrait de cinéma', 'cinema', 'templates/portrait-cinema/video.mp4', 'kling-4',
 '[{"text":"Plan cinéma dans une rame de métro bondée, le soir. La personne de la photo, debout contre la barre, regarde la caméra, ajuste ses lunettes et esquisse un sourire pendant que la foule passe floue autour d''elle. Lumière néon froide, faible profondeur de champ, grain de film.","dur":15}]',
 '1080p', '16:9', 1, 'Une photo de la personne', 40, 1, unixepoch() * 1000),
('histoire-papier', 'Histoire en papier découpé', 'explication', 'templates/histoire-papier/video.mp4', 'wan-3',
 '[{"text":"Animation en papier découpé sur un vieux parchemin éclairé par une lanterne : une mer de vagues en papier bleu, une barque avance avec un buste de Jules César, des pirates en silhouettes noires brandissent leurs sabres, un point d''interrogation rouge apparaît. Une voix off raconte : « À 25 ans, Jules César a été enlevé par des pirates. » Texture de papier, mouvements saccadés image par image.","dur":10}]',
 '1080p', '16:9', 1, NULL, 50, 1, unixepoch() * 1000);
