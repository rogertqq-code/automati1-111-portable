/**
 * PM2 Ecosystem Configuration
 *
 * Manages the Automati server and OpenClaw gateway as daemon processes.
 * Auto-restarts on crash with exponential backoff.
 */
module.exports = {
  apps: [
    {
      name: "automati-server",
      script: "npx",
      args: "tsx src/server/server.ts",
      cwd: __dirname,
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: "2G",
      exp_backoff_restart_delay: 1000,
      // Restart after 3 consecutive 0-exit-code crashes (shouldn't happen)
      min_uptime: "10s",
      max_restarts: 50,
      // Environment
      env: {
        NODE_ENV: "production",
        NODE_OPTIONS: "--max-old-space-size=2048",
        FORCE_COLOR: "1",
      },
      // Logging
      error_file: "./logs/automati-server-error.log",
      out_file: "./logs/automati-server-out.log",
      merge_logs: true,
      log_date_format: "YYYY-MM-DD HH:mm:ss Z",
      // Graceful shutdown
      kill_timeout: 10000,
      listen_timeout: 15000,
      shutdown_with_message: true,
    },
    {
      name: "openclaw-gateway",
      script: "openclaw",
      args: "gateway",
      cwd: __dirname,
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: "1G",
      exp_backoff_restart_delay: 2000,
      min_uptime: "10s",
      max_restarts: 20,
      env: {
        NODE_ENV: "production",
        FORCE_COLOR: "1",
      },
      error_file: "./logs/openclaw-error.log",
      out_file: "./logs/openclaw-out.log",
      merge_logs: true,
      log_date_format: "YYYY-MM-DD HH:mm:ss Z",
      kill_timeout: 5000,
    },
  ],
};
