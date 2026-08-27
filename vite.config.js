import { defineConfig } from 'vite';

// This project lives on a Windows drive mounted into WSL2 (/mnt/d/...).
// inotify file-change events don't fire across that boundary, so Vite's
// watcher never sees saves and HMR/auto-reload silently stops working.
// Polling makes chokidar detect changes regardless of the filesystem.
export default defineConfig({
  server: {
    watch: {
      usePolling: true,
      interval: 100,
    },
  },
});
