import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import fs from 'fs';
import path from 'path';

// point to the certs you generated with mkcert
const certDir = path.resolve(__dirname, 'certs');
const certPath = path.join(certDir, '10.16.151.138+2.pem');
const keyPath  = path.join(certDir, '10.16.151.138+2-key.pem');

export default defineConfig({
  plugins: [react()],
  server: {
    host: '0.0.0.0',
    port: 5173,
    https: {
      cert: fs.readFileSync(certPath),
      key:  fs.readFileSync(keyPath),
    },
    // HMR must be WSS when dev server is HTTPS
    hmr: {
      host: '10.16.151.138', // your LAN IP from mkcert SANs
      protocol: 'wss',
      port: 5173,
    },
  },
});
