#!/bin/bash
#
# Monitoring Setup Script
#
# This script sets up the monitoring infrastructure for Jarvis:
# - Checks for required dependencies
# - Creates monitoring directory structure
# - Sets up cron job or systemd service for metric aggregation
# - Exports metrics in Prometheus format
#
# Usage:
#   bash scripts/monitoring/setup.sh [options]
#
# Options:
#   --scheduler <cron|systemd|none>  Scheduler to use (default: auto-detect)
#   --interval <minutes>             Export interval in minutes (default: 1)
#   --output <path>                  Metrics output path (default: data/monitoring/metrics.prom)
#   --uninstall                      Remove monitoring setup
#   --help                           Show this help message
#

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Default configuration
SCHEDULER="auto"
INTERVAL=1
OUTPUT_PATH="data/monitoring/metrics.prom"
UNINSTALL=false
PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

# Parse command line arguments
while [[ $# -gt 0 ]]; do
  case $1 in
    --scheduler)
      SCHEDULER="$2"
      shift 2
      ;;
    --interval)
      INTERVAL="$2"
      shift 2
      ;;
    --output)
      OUTPUT_PATH="$2"
      shift 2
      ;;
    --uninstall)
      UNINSTALL=true
      shift
      ;;
    --help|-h)
      cat << EOF
Monitoring Setup Script

Usage:
  bash scripts/monitoring/setup.sh [options]

Options:
  --scheduler <cron|systemd|none>  Scheduler to use (default: auto-detect)
  --interval <minutes>             Export interval in minutes (default: 1)
  --output <path>                  Metrics output path (default: data/monitoring/metrics.prom)
  --uninstall                      Remove monitoring setup
  --help, -h                       Show this help message

Examples:
  # Auto-detect scheduler and set up monitoring
  bash scripts/monitoring/setup.sh

  # Use cron with custom interval
  bash scripts/monitoring/setup.sh --scheduler cron --interval 5

  # Use systemd with custom output path
  bash scripts/monitoring/setup.sh --scheduler systemd --output /var/lib/jarvis/metrics.prom

  # Remove monitoring setup
  bash scripts/monitoring/setup.sh --uninstall

EOF
      exit 0
      ;;
    *)
      echo -e "${RED}Unknown argument: $1${NC}"
      exit 1
      ;;
  esac
done

# Helper functions
log_info() {
  echo -e "${BLUE}[INFO]${NC} $1"
}

log_success() {
  echo -e "${GREEN}[SUCCESS]${NC} $1"
}

log_warning() {
  echo -e "${YELLOW}[WARNING]${NC} $1"
}

log_error() {
  echo -e "${RED}[ERROR]${NC} $1"
}

# Check if running as root (needed for systemd)
check_root() {
  if [[ $EUID -eq 0 ]] && [[ "$SCHEDULER" == "systemd" ]]; then
    log_warning "Running as root for systemd setup"
    return 0
  fi
  if [[ $EUID -ne 0 ]] && [[ "$SCHEDULER" == "systemd" ]]; then
    log_error "Systemd setup requires root privileges. Run with sudo."
    exit 1
  fi
  return 0
}

# Check for required dependencies
check_dependencies() {
  log_info "Checking dependencies..."

  # Check Node.js
  if ! command -v node &> /dev/null; then
    log_error "Node.js is not installed. Please install Node.js 18+ first."
    exit 1
  fi

  NODE_VERSION=$(node --version | cut -d'v' -f2 | cut -d'.' -f1)
  if [ "$NODE_VERSION" -lt 18 ]; then
    log_error "Node.js version must be 18 or higher (found: $(node --version))"
    exit 1
  fi
  log_success "Node.js $(node --version) found"

  # Check tsx
  if ! command -v tsx &> /dev/null && ! [ -f "$PROJECT_ROOT/node_modules/.bin/tsx" ]; then
    log_error "tsx is not installed. Run: npm install"
    exit 1
  fi
  log_success "tsx found"

  # Check for scheduler
  if [ "$SCHEDULER" == "auto" ]; then
    if command -v systemctl &> /dev/null; then
      SCHEDULER="systemd"
      log_info "Auto-detected systemd"
    elif command -v crontab &> /dev/null; then
      SCHEDULER="cron"
      log_info "Auto-detected cron"
    else
      SCHEDULER="none"
      log_warning "No scheduler detected. Metrics export must be run manually."
    fi
  fi
}

# Create monitoring directory structure
setup_directories() {
  log_info "Creating monitoring directories..."

  mkdir -p "$PROJECT_ROOT/data/monitoring"
  mkdir -p "$PROJECT_ROOT/logs"

  # Ensure output directory exists
  OUTPUT_DIR=$(dirname "$OUTPUT_PATH")
  if [[ "$OUTPUT_PATH" == /* ]]; then
    # Absolute path
    mkdir -p "$OUTPUT_DIR"
  else
    # Relative path
    mkdir -p "$PROJECT_ROOT/$OUTPUT_DIR"
  fi

  log_success "Directories created"
}

# Setup cron job
setup_cron() {
  log_info "Setting up cron job..."

  # Create cron script wrapper
  CRON_SCRIPT="$PROJECT_ROOT/scripts/monitoring/export-metrics-cron.sh"
  cat > "$CRON_SCRIPT" << EOF
#!/bin/bash
# Auto-generated cron wrapper for metrics export
cd "$PROJECT_ROOT"
npx tsx scripts/monitoring/export-metrics.ts --output "$OUTPUT_PATH" >> logs/metrics-export.log 2>&1
EOF

  chmod +x "$CRON_SCRIPT"

  # Add to crontab
  CRON_ENTRY="*/$INTERVAL * * * * $CRON_SCRIPT"

  # Check if entry already exists
  if crontab -l 2>/dev/null | grep -F "$CRON_SCRIPT" > /dev/null; then
    log_warning "Cron job already exists. Updating..."
    crontab -l 2>/dev/null | grep -v "$CRON_SCRIPT" | crontab -
  fi

  # Add new entry
  (crontab -l 2>/dev/null; echo "$CRON_ENTRY") | crontab -

  log_success "Cron job installed (runs every $INTERVAL minute(s))"
  log_info "Logs: $PROJECT_ROOT/logs/metrics-export.log"
}

# Setup systemd service and timer
setup_systemd() {
  log_info "Setting up systemd service and timer..."

  SERVICE_NAME="jarvis-metrics-export"
  SERVICE_FILE="/etc/systemd/system/${SERVICE_NAME}.service"
  TIMER_FILE="/etc/systemd/system/${SERVICE_NAME}.timer"

  # Determine the user to run as
  if [[ $EUID -eq 0 ]]; then
    # If running as root, use the SUDO_USER if available
    RUN_USER="${SUDO_USER:-$USER}"
  else
    RUN_USER="$USER"
  fi

  # Create service file
  cat > "$SERVICE_FILE" << EOF
[Unit]
Description=Jarvis Metrics Export Service
After=network.target

[Service]
Type=oneshot
User=$RUN_USER
WorkingDirectory=$PROJECT_ROOT
ExecStart=$(command -v npx || echo "/usr/bin/npx") tsx scripts/monitoring/export-metrics.ts --output $OUTPUT_PATH
StandardOutput=append:$PROJECT_ROOT/logs/metrics-export.log
StandardError=append:$PROJECT_ROOT/logs/metrics-export.log

[Install]
WantedBy=multi-user.target
EOF

  # Create timer file
  cat > "$TIMER_FILE" << EOF
[Unit]
Description=Jarvis Metrics Export Timer
Requires=${SERVICE_NAME}.service

[Timer]
OnBootSec=1min
OnUnitActiveSec=${INTERVAL}min
AccuracySec=1s

[Install]
WantedBy=timers.target
EOF

  # Reload systemd and enable timer
  systemctl daemon-reload
  systemctl enable "${SERVICE_NAME}.timer"
  systemctl start "${SERVICE_NAME}.timer"

  log_success "Systemd service and timer installed"
  log_info "Service: $SERVICE_FILE"
  log_info "Timer: $TIMER_FILE"
  log_info "Logs: $PROJECT_ROOT/logs/metrics-export.log"
  log_info "Check status: systemctl status ${SERVICE_NAME}.timer"
}

# Uninstall monitoring setup
uninstall() {
  log_info "Removing monitoring setup..."

  # Remove cron job
  if crontab -l 2>/dev/null | grep "export-metrics-cron.sh" > /dev/null; then
    crontab -l 2>/dev/null | grep -v "export-metrics-cron.sh" | crontab -
    log_success "Cron job removed"
  fi

  # Remove cron script
  if [ -f "$PROJECT_ROOT/scripts/monitoring/export-metrics-cron.sh" ]; then
    rm -f "$PROJECT_ROOT/scripts/monitoring/export-metrics-cron.sh"
    log_success "Cron script removed"
  fi

  # Remove systemd service and timer
  SERVICE_NAME="jarvis-metrics-export"
  if systemctl list-unit-files | grep -q "${SERVICE_NAME}.timer"; then
    if [[ $EUID -eq 0 ]]; then
      systemctl stop "${SERVICE_NAME}.timer" 2>/dev/null || true
      systemctl disable "${SERVICE_NAME}.timer" 2>/dev/null || true
      rm -f "/etc/systemd/system/${SERVICE_NAME}.service"
      rm -f "/etc/systemd/system/${SERVICE_NAME}.timer"
      systemctl daemon-reload
      log_success "Systemd service and timer removed"
    else
      log_error "Removing systemd service requires root privileges. Run with sudo."
      exit 1
    fi
  fi

  log_success "Monitoring setup removed"
  exit 0
}

# Test metrics export
test_export() {
  log_info "Testing metrics export..."

  cd "$PROJECT_ROOT"
  npx tsx scripts/monitoring/export-metrics.ts --output "$OUTPUT_PATH"

  if [ -f "$OUTPUT_PATH" ] || [ -f "$PROJECT_ROOT/$OUTPUT_PATH" ]; then
    log_success "Metrics export test successful"
  else
    log_error "Metrics export test failed"
    exit 1
  fi
}

# Main setup function
main() {
  echo ""
  echo "╔════════════════════════════════════════╗"
  echo "║   Jarvis Monitoring Setup Script      ║"
  echo "╚════════════════════════════════════════╝"
  echo ""

  # Handle uninstall
  if [ "$UNINSTALL" = true ]; then
    uninstall
    exit 0
  fi

  # Check root if needed
  check_root

  # Check dependencies
  check_dependencies

  # Create directories
  setup_directories

  # Test export first
  test_export

  # Setup scheduler
  case "$SCHEDULER" in
    cron)
      setup_cron
      ;;
    systemd)
      setup_systemd
      ;;
    none)
      log_warning "No scheduler configured. Run metrics export manually:"
      log_info "  npx tsx scripts/monitoring/export-metrics.ts --output $OUTPUT_PATH"
      ;;
    *)
      log_error "Invalid scheduler: $SCHEDULER"
      exit 1
      ;;
  esac

  echo ""
  log_success "Monitoring setup complete!"
  echo ""
  echo "Configuration:"
  echo "  Scheduler:  $SCHEDULER"
  echo "  Interval:   $INTERVAL minute(s)"
  echo "  Output:     $OUTPUT_PATH"
  echo ""
  echo "Next steps:"
  echo "  1. Configure your Prometheus server to scrape: $OUTPUT_PATH"
  echo "  2. Check logs at: $PROJECT_ROOT/logs/metrics-export.log"
  echo "  3. Test manually: npx tsx scripts/monitoring/export-metrics.ts"
  echo ""

  # Show scheduler-specific instructions
  if [ "$SCHEDULER" == "systemd" ]; then
    echo "Systemd commands:"
    echo "  Status:  systemctl status jarvis-metrics-export.timer"
    echo "  Logs:    journalctl -u jarvis-metrics-export.service -f"
    echo "  Trigger: systemctl start jarvis-metrics-export.service"
    echo ""
  elif [ "$SCHEDULER" == "cron" ]; then
    echo "Cron commands:"
    echo "  List:    crontab -l | grep jarvis"
    echo "  Logs:    tail -f $PROJECT_ROOT/logs/metrics-export.log"
    echo ""
  fi
}

# Run main function
main
