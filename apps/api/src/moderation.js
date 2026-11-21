/**
 * Contrôle minimal du texte avant tout débit : un refus ne coûte rien. Ce n'est pas une modération : un seul marqueur explicite, en mot
 * entier. Les mots courants (« sang », « violence », « interdit ») n'y sont plus : ils refusaient le nom Sangaré ou une campagne contre
 * la violence. Le vrai contrôle est celui du fournisseur (échec `moderation`, remboursé). À remplacer par une vraie modération.
 */
const BLOCKED = /(?<![\p{L}\p{N}_])nsfw(?![\p{L}\p{N}_])/iu
export const isBlocked = (text) => BLOCKED.test(text ?? '')
/**
 * Tout le texte libre d'une demande qui part dans la consigne du fournisseur : `texts` (prompt, plans, champs de texte), plus le style
 * choisi et le style de la marque, que l'application envoie à part et qui sont ajoutés à la consigne (voir inputs.js).
 */
export const checkedText = (req, texts) => [...texts, req.styleHint, req.brandStyle].filter(Boolean).map(String).join(' ')
