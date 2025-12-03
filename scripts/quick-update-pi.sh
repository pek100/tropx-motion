#!/bin/bash

# TropX Motion - Quick Update (no npm install)
# Use this for code changes that don't affect dependencies

set -e

PI_USER="${PI_USER:-pek}"
PI_HOST="${PI_HOST:-pi.local}"
PI_DIR="${PI_DIR:-~/tropxmotion}"
PI_SSH="$PI_USER@$PI_HOST"

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

echo -e "${GREEN}🔄 Quick Update to Raspberry Pi${NC}"
echo ""

# Transfer only source files
echo -e "${YELLOW}📦 Syncing source files...${NC}"
rsync -avz \
    --delete \
    --exclude 'node_modules' \
    --exclude 'dist' \
    --exclude 'build' \
    --exclude '.git' \
    --include 'electron/***' \
    --include 'ble-bridge/***' \
    --include 'websocket-bridge/***' \
    --include 'motionProcessing/***' \
    --include 'shared/***' \
    --include 'ble-management/***' \
    --include 'scripts/***' \
    --include '*.json' \
    --include '*.ts' \
    --include '*.tsx' \
    --exclude '*' \
    ./ "$PI_SSH:$PI_DIR/"

echo -e "${GREEN}✅ Files synced${NC}"
echo ""

# Rebuild only
echo -e "${YELLOW}🔨 Rebuilding...${NC}"
ssh "$PI_SSH" bash << 'REMOTE'
cd ~/tropxmotion
export NODE_OPTIONS="--max-old-space-size=1024"
npm run build
echo "✅ Rebuild complete"
REMOTE

echo ""
echo -e "${GREEN}✅ Update complete! App is ready to run.${NC}"
echo ""
