import { Component } from 'react'
import { reportError } from '../lib/sentry.js'

/** Écran d'une erreur imprévue de l'interface, signalée à Sentry s'il est actif : recharger suffit le plus souvent. */
export default class Crash extends Component {
  state = { failed: false }

  static getDerivedStateFromError() { return { failed: true } }

  componentDidCatch(error, info) { reportError(error, info?.componentStack) }

  render() {
    if (!this.state.failed) return this.props.children
    return (
      <main role="alert" style={{ minHeight: '100vh', display: 'grid', placeContent: 'center', gap: 16, padding: 24, textAlign: 'center' }}>
        <h1 style={{ fontSize: 20, margin: 0 }}>Une erreur est survenue.</h1>
        <p style={{ margin: 0 }}>Vos fichiers et vos jetons ne sont pas touchés.</p>
        <button type="button" onClick={() => location.reload()} style={{ justifySelf: 'center' }}>Recharger la page</button>
      </main>
    )
  }
}
