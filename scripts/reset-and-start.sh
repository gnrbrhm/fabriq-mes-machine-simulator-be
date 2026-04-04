#!/bin/bash
#
# Fabriq MES - Temiz Reset + Sistem Yeniden Baslat
#
# Kullanim:
#   ./scripts/reset-and-start.sh           # Varsayilan (15x, 06:00)
#   ./scripts/reset-and-start.sh 30        # 30x hiz
#   ./scripts/reset-and-start.sh 60 08:00  # 60x hiz, 08:00'dan
#

SPEED=${1:-15}
START_TIME=${2:-06:00}
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
SIM_DIR="$(dirname "$SCRIPT_DIR")"
BACKEND_DIR="$(cd "$SIM_DIR/../../backend/fabriq-mes" && pwd)"

echo ""
echo "╔═══════════════════════════════════════════╗"
echo "║  Fabriq MES - Temiz Reset + Baslat        ║"
echo "╠═══════════════════════════════════════════╣"
echo "║  Hiz: ${SPEED}x  |  Baslangic: ${START_TIME}          ║"
echo "╚═══════════════════════════════════════════╝"
echo ""

# 1. Simulator durdur
echo "🛑 Simulator durduruluyor..."
pkill -f "tsx src/main" 2>/dev/null
sleep 1

# 2. Backend durdur
echo "🛑 Backend durduruluyor..."
pkill -f "node dist/apps/fabriq-mes/main.js" 2>/dev/null
sleep 2

# 3. Backend baslat
echo "🚀 Backend baslatiliyor..."
cd "$BACKEND_DIR"
node dist/apps/fabriq-mes/main.js > /tmp/fabriq-be.log 2>&1 &
BACKEND_PID=$!
echo "   PID: $BACKEND_PID"

# Backend hazir olmasini bekle
echo "   Backend hazir olmasini bekliyoruz..."
for i in $(seq 1 20); do
  STATUS=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:3000/api/health 2>/dev/null)
  if [ "$STATUS" = "200" ]; then
    echo "   ✅ Backend hazir!"
    break
  fi
  sleep 1
done

# 4. Reset + Seed + Simulasyon
echo ""
echo "🔄 Reset + Seed + Simulasyon baslatiliyor..."
cd "$SIM_DIR"
KAFKAJS_NO_PARTITIONER_WARNING=1 npx tsx src/main.ts --reset --start "$START_TIME" --speed "$SPEED" > /tmp/fabriq-sim.log 2>&1 &
SIM_PID=$!
echo "   Simulator PID: $SIM_PID"

# 5. Bekle ve dogrula
sleep 15
echo ""
echo "╔═══════════════════════════════════════════╗"
echo "║  ✅ Sistem hazir!                          ║"
echo "╠═══════════════════════════════════════════╣"
echo "║  Backend:   http://localhost:3000          ║"
echo "║  Frontend:  http://localhost:3001          ║"
echo "║  Swagger:   http://localhost:3000/api/docs ║"
echo "║  Kafka UI:  http://localhost:8080          ║"
echo "║  Login:     admin@fabriq.io / admin123     ║"
echo "╚═══════════════════════════════════════════╝"
echo ""
echo "Simulator log: tail -f /tmp/fabriq-sim.log"
echo "Backend log:   tail -f /tmp/fabriq-be.log"
echo ""
