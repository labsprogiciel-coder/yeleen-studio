import { createContext, useContext, useEffect, useState, useMemo } from 'react'

const STORAGE_KEY = 'yeelen.theme.v1'
const FALLBACK_KEY = 'theme'

function readStoredTheme() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY) || localStorage.getItem(FALLBACK_KEY)
    if (saved === 'light' || saved === 'dark') return saved
    if (window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches) {
      return 'light'
    }
  } catch {
    // Ignore storage errors in restricted contexts
  }
  return 'dark'
}

const ThemeContext = createContext({
  theme: 'dark',
  setTheme: () => {},
  toggleTheme: () => {},
  isDark: true,
  isLight: false,
})

export function ThemeProvider({ children }) {
  const [theme, setThemeState] = useState(readStoredTheme)

  useEffect(() => {
    const root = document.documentElement
    root.setAttribute('data-theme', theme)
    root.style.colorScheme = theme
    try {
      localStorage.setItem(STORAGE_KEY, theme)
      localStorage.setItem(FALLBACK_KEY, theme)
    } catch {
      // Ignore storage errors
    }
  }, [theme])

  // Listen to system theme changes if no explicit user override is stored
  useEffect(() => {
    if (!window.matchMedia) return
    const mq = window.matchMedia('(prefers-color-scheme: light)')
    const onChange = (e) => {
      try {
        const saved = localStorage.getItem(STORAGE_KEY)
        if (!saved) {
          setThemeState(e.matches ? 'light' : 'dark')
        }
      } catch {
        // Ignore
      }
    }
    mq.addEventListener?.('change', onChange)
    return () => mq.removeEventListener?.('change', onChange)
  }, [])

  const toggleTheme = () => {
    setThemeState((prev) => (prev === 'dark' ? 'light' : 'dark'))
  }

  const setTheme = (t) => {
    if (t === 'light' || t === 'dark') setThemeState(t)
  }

  const value = useMemo(
    () => ({
      theme,
      setTheme,
      toggleTheme,
      isDark: theme === 'dark',
      isLight: theme === 'light',
    }),
    [theme]
  )

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
}

export function useTheme() {
  return useContext(ThemeContext)
}
