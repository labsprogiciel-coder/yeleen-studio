/** Sélecteur de mode en une rangée (Script / Audio…). Même sémantique que Segment.jsx : radiogroup + radio. */
export default function Segmented({ items, value, onChange, label }) {
  return (
    <div className="ep-seg" role="radiogroup" aria-label={label}>
      {items.map((it) => (
        <button
          key={it.id}
          type="button"
          role="radio"
          aria-checked={it.id === value}
          onClick={() => onChange(it.id)}
        >
          {it.title ?? it.label}
        </button>
      ))}
    </div>
  )
}
