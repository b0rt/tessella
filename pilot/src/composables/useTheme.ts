import { ref, watch } from 'vue'

type Theme = 'light' | 'dark'

const STORAGE_KEY = 'tessella-theme'

const theme = ref<Theme>(getInitialTheme())

function getInitialTheme(): Theme {
  const stored = localStorage.getItem(STORAGE_KEY)
  if (stored === 'light' || stored === 'dark') return stored
  return 'dark'
}

function applyTheme(t: Theme) {
  document.documentElement.classList.toggle('dark', t === 'dark')
}

// Apply on load
applyTheme(theme.value)

watch(theme, (newTheme) => {
  localStorage.setItem(STORAGE_KEY, newTheme)
  applyTheme(newTheme)
})

export function useTheme() {
  function toggleTheme() {
    theme.value = theme.value === 'dark' ? 'light' : 'dark'
  }

  return {
    theme,
    toggleTheme,
  }
}
