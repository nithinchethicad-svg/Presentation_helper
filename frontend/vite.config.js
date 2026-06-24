import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/fonts': 'http://localhost:5000',
      '/templates': 'http://localhost:5000',
      '/extracted_media': 'http://localhost:5000',
    }
  }
})
