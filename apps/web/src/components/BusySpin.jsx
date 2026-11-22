/** Roue d'attente d'un bouton en cours d'envoi (styles/global.css) ; le texte voisin (« Envoi… ») ou `aria-busy` dit ce qui se passe. */
export default function BusySpin() {
  return <i className="busy-spin" aria-hidden="true" />
}
