/**
 * PM2 Ecosystem Configuration for Jarvis
 *
 * Usage:
 *   pm2 start ecosystem.config.cjs           # Start all processes
 *   pm2 start ecosystem.config.cjs --only jarvis      # Start Jarvis only
 *   pm2 start ecosystem.config.cjs --only jarvis-ceo  # Start CEO bot only
 *   pm2 stop jarvis                          # Stop
 *   pm2 restart jarvis                       # Restart
 *   pm2 reload jarvis                        # Zero-downtime reload
 *   pm2 logs jarvis                          # Tail logs
 *   pm2 logs jarvis --lines 200              # Last 200 lines
 *   pm2 monit                                # Real-time dashboard
 *   pm2 status                               # Quick status
 *   pm2 startup                              # Configure auto-start on boot
 *   pm2 save                                 # Save process list for reboot
 *   pm2 delete jarvis                        # Remove from PM2
 */

const path = require('path');

module.exports = {
  apps: [
    {
      name: 'jarvis',
      script: 'dist/index.js',
      cwd: __dirname,
      node_args: '--enable-source-maps',

      // Process behavior
      instances: 1,
      exec_mode: 'fork',
      autorestart: true,
      watch: false,
      max_memory_restart: '2G', // Increased from 1G to reduce restarts during memory-intensive operations (LLM, embedding generation)
      min_uptime: '10s',
      max_restarts: 1000, // Increased to prevent PM2 from stopping jarvis due to high restart count from Telegram TIMEOUT errors
      restart_delay: 10000, // Increased from 5000ms to reduce restart frequency

      // Environment
      env: {
        NODE_ENV: 'production',
        CLAUDECODE: '', // Prevent "nested Claude Code session" errors
        LLM_TIMEOUT_MS: 60000, // 60 seconds - ensure LLM timeout is correctly set (PM2 stores env at startup)
      },

      // Logging
      error_file: 'logs/pm2-error.log',
      out_file: 'logs/pm2-out.log',
      log_file: 'logs/pm2-combined.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss.SSS Z',
      merge_logs: true,
      log_type: 'json',

      // Graceful shutdown
      kill_timeout: 10000,
      wait_ready: false,
      listen_timeout: 10000,

      // Health monitoring with exponential backoff
      exp_backoff_restart_delay: 100, // Initial delay (ms), multiplied on each restart

      // Advanced stability settings
      vizion: false, // Disable git metadata (reduces overhead)
      treekill: true, // Properly kill all child processes on stop
      automation: false, // Disable PM2 web dashboard
    },
    {
      name: 'jarvis-ceo',
      script: 'dist/index.js',
      cwd: __dirname,
      node_args: '--enable-source-maps -r dotenv/config',

      // Process behavior
      instances: 1,
      exec_mode: 'fork',
      autorestart: true,
      watch: false,
      max_memory_restart: '512M',
      min_uptime: '10s',
      max_restarts: 10,
      restart_delay: 5000,

      // Environment - separate .env and data directory
      env: {
        NODE_ENV: 'production',
        DOTENV_CONFIG_PATH: path.join(__dirname, '.env.ceo'),
        DATA_DIR: path.join(__dirname, 'data-ceo'),
        CLAUDECODE: '',
        LLM_TIMEOUT_MS: 60000, // 60 seconds - ensure LLM timeout is correctly set (PM2 stores env at startup)
      },

      // Logging
      error_file: 'logs/ceo-pm2-error.log',
      out_file: 'logs/ceo-pm2-out.log',
      log_file: 'logs/ceo-pm2-combined.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss.SSS Z',
      merge_logs: true,
      log_type: 'json',

      // Graceful shutdown
      kill_timeout: 10000,
      wait_ready: false,
      listen_timeout: 10000,

      // Health monitoring with exponential backoff
      exp_backoff_restart_delay: 100,

      // Advanced stability settings
      vizion: false,
      treekill: true,
      automation: false,
    },
    {
      name: 'whisper',
      script: './services/whisper/start.sh',
      cwd: __dirname,
      interpreter: '/bin/bash',

      // Process behavior
      instances: 1,
      exec_mode: 'fork',
      autorestart: true,
      watch: false,
      max_memory_restart: '2G',
      min_uptime: '10s',
      max_restarts: 10,
      restart_delay: 1000,

      // Environment
      env: {
        WHISPER_MODEL: 'base',
        WHISPER_DEVICE: 'auto',
        WHISPER_COMPUTE_TYPE: 'auto',
        WHISPER_HOST: '127.0.0.1',
        WHISPER_PORT: '9000',
        LOG_LEVEL: 'INFO',
        LOG_FORMAT: 'json',
      },

      // Logging
      error_file: 'logs/whisper-error.log',
      out_file: 'logs/whisper.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss.SSS Z',
      merge_logs: true,

      // Graceful shutdown
      kill_timeout: 10000,
      wait_ready: false,
      listen_timeout: 30000,

      // Health monitoring with exponential backoff
      exp_backoff_restart_delay: 100,

      // Advanced stability settings
      vizion: false,
      treekill: true,
      automation: false,
    },
  ],
};
