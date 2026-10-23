export default function Segmented({ items, value, onChange, label }) {
  return (
    <div className="ep-seg" role="tablist" aria-label={label}>
      {items.map((it) => (
        <button
          key={it.id}
          type="button"
          role="tab"
          aria-selected={it.id === value}
          onClick={() => onChange(it.id)}
        >
          {it.title ?? it.label}
        </button>
      ))}
    </div>
  )
}
