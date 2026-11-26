import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')

  return {
    define: {
      __PUBLIC_SITE_URL__: JSON.stringify(process.env.PUBLIC_SITE_URL ?? env.PUBLIC_SITE_URL ?? ''),
    },
    plugins: [
      react(),
      tailwindcss(),
    ],
  }
})