import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icon.svg'],
      manifest: {
        name: 'Plus d\'excuses Transcription',
        short_name: 'Transcription',
        description: 'Transcribe your French podcasts locally using Whisper WebGPU/WASM',
        theme_color: '#0a0a0c',
        background_color: '#0a0a0c',
        display: 'standalone',
        orientation: 'portrait',
        icons: [
          {
            src: 'icon.svg',
            sizes: '192x192 512x512',
            type: 'image/svg+xml',
            purpose: 'any maskable'
          }
        ]
      },
      workbox: {
        // Exclude larger audio samples from the SW precache list
        globPatterns: ['**/*.{js,css,html,png,svg,ico}']
      }
    })
  ]
});
