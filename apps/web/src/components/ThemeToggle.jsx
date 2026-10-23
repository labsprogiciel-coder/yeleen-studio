import { useTheme } from '../lib/theme.jsx'
import Icon from '../lib/icons.jsx'

export default function ThemeToggle({ className = 'theme-toggle', size = 18, showLabel = false }) {
  const { theme, toggleTheme, isDark } = useTheme()
  const label = isDark ? 'Mode clair' : 'Mode sombre'
  const nextThemeAction = isDark ? 'Activer le mode clair' : 'Activer le mode sombre'

  return (
    <button
      type="button"
      className={className}
      onClick={toggleTheme}
      aria-label={nextThemeAction}
      title={label}
      data-theme-switcher
    >
      <Icon name={isDark ? 'sun' : 'moon'} size={size} />
      {showLabel && <span>{label}</span>}
    </button>
  )
}
