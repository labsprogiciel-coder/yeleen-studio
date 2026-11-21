/**
 * Contrôle minimal du texte avant tout débit : un refus ne coûte rien. Ce n'est pas une modération : un seul marqueur explicite. Les mots
 * courants (« sang », « violence », « interdit ») n'y sont plus : ils refusaient le nom Sangaré ou une campagne contre la violence.
 * « nsfw » est cherché partout, pas en mot entier : aucun mot courant ne le contient, et « nsfw_art » ou « nsfw18 » doivent rester
 * refusés. Le texte est d'abord ramené à sa forme simple (pleine chasse « ｎｓｆｗ », caractères invisibles retirés).
 * Le vrai contrôle est celui du fournisseur (échec `moderation`, remboursé). À remplacer par une vraie modération.
 */
const BLOCKED = /nsfw/i
export const isBlocked = (text) => BLOCKED.test(String(text ?? '').normalize('NFKC').replace(/\p{Cf}/gu, ''))
/**
 * Tout le texte libre d'une demande qui part dans la consigne du fournisseur : `texts` (prompt, plans, champs de texte), plus le style
 * choisi et le style de la marque, que l'application envoie à part et qui sont ajoutés à la consigne (voir inputs.js).
 */
export const checkedText = (req, texts) => [...texts, req.styleHint, req.brandStyle].filter(Boolean).map(String).join(' ')
