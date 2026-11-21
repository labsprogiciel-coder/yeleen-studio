/** Interrupteur « Publié / Brouillon ». */
export default function Switch({ on, busy, onToggle, label, disabled }) {
  return (
    <button type="button" role="switch" aria-checked={Boolean(on)} className={`tm-switch${on ? ' on' : ''}`} disabled={busy || disabled} onClick={onToggle}
      aria-label={label ? `Publier « ${label} »` : undefined}>
      <i aria-hidden="true" /><span>{busy ? '…' : on ? 'Publié' : 'Brouillon'}</span>
    </button>
  )
}
