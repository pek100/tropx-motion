#!/bin/bash

# TropX Motion - Build for Pi using Docker (FAST!)
# Builds ARM64 version on your powerful PC instead of slow Pi
#
# Based on Docker Multi-Platform Build best practices:
# - Uses QEMU emulation for ARM64 (docker.com/blog/faster-multi-platform-builds)
# - Compiles native modules correctly for target architecture
# - Layer caching for faster rebuilds

set -e

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
BLUE='\033[0;34m'
NC='\033[0m'

echo -e "${GREEN}========================================${NC}"
echo -e "${GREEN}TropX Motion - Docker Pi Build${NC}"
echo -e "${GREEN}========================================${NC}"
echo ""

# Check Docker
if ! command -v docker &> /dev/null; then
    echo -e "${RED}❌ Docker not found${NC}"
    echo ""
    echo "Install Docker Desktop for Windows:"
    echo "  https://www.docker.com/products/docker-desktop/"
    echo ""
    echo "Then enable WSL 2 integration in Docker Desktop settings"
    exit 1
fi

# Check Docker is running
if ! docker info &> /dev/null; then
    echo -e "${RED}❌ Docker is not running${NC}"
    echo "Please start Docker Desktop"
    exit 1
fi

echo -e "${GREEN}✅ Docker is running${NC}"
echo ""

# Check for buildx (multi-platform support)
if ! docker buildx version &> /dev/null; then
    echo -e "${YELLOW}⚠️  Docker buildx not found${NC}"
    echo "Docker buildx is required for multi-platform builds"
    echo ""
    echo "Trying to install buildx..."
    docker buildx install || {
        echo -e "${RED}❌ Failed to install buildx${NC}"
        echo "Please update Docker Desktop to the latest version"
        exit 1
    }
fi

echo -e "${GREEN}✅ Docker buildx available${NC}"
echo ""

# Setup QEMU for ARM64 emulation
echo -e "${YELLOW}🔧 Setting up ARM64 emulation (QEMU)...${NC}"
docker run --rm --privileged multiarch/qemu-user-static --reset -p yes &> /dev/null || {
    echo -e "${YELLOW}⚠️  QEMU setup warning (may already be configured)${NC}"
}
echo -e "${GREEN}✅ ARM64 emulation ready${NC}"
echo ""

# Create buildx builder if needed
BUILDER_NAME="tropxmotion-builder"
if ! docker buildx inspect "$BUILDER_NAME" &> /dev/null; then
    echo -e "${YELLOW}📦 Creating buildx builder instance...${NC}"
    docker buildx create --name "$BUILDER_NAME" --use &> /dev/null
    echo -e "${GREEN}✅ Builder created: $BUILDER_NAME${NC}"
else
    echo -e "${GREEN}✅ Using existing builder: $BUILDER_NAME${NC}"
    docker buildx use "$BUILDER_NAME"
fi
echo ""

echo -e "${YELLOW}🔨 Building for ARM64 (Raspberry Pi)...${NC}"
echo -e "${BLUE}⏳ Estimated time:${NC}"
echo "   - First build: 10-20 minutes"
echo "   - Cached builds: 3-5 minutes"
echo ""
echo -e "${BLUE}📊 Build info:${NC}"
echo "   - Platform: linux/arm64 (Raspberry Pi 3/4/5)"
echo "   - Emulation: QEMU ARM64"
echo "   - Native modules: Will compile for ARM64"
echo ""

# Build image with buildx
echo -e "${YELLOW}📦 Step 1/3: Building Docker image...${NC}"
echo ""

# Use buildx for proper multi-platform support
# Use --no-cache to ensure fresh build and see all output
docker buildx build \
    --platform linux/arm64 \
    --load \
    --no-cache \
    -f Dockerfile.pi \
    -t tropxmotion-pi:latest \
    --progress=plain \
    . 2>&1 | tee /tmp/docker-build-full.log | grep -E "(Step|Installing|Building|ERROR|WARNING|Verifying|Node version|NPM version|PATH:)" || true

# Check build succeeded
if [ $? -ne 0 ]; then
    echo -e "${RED}❌ Build failed${NC}"
    echo "Check the logs above for errors"
    exit 1
fi

echo ""
echo -e "${GREEN}✅ Build complete!${NC}"
echo ""
echo -e "${YELLOW}📦 Step 2/3: Extracting build...${NC}"

# Extract build artifacts
mkdir -p build/pi-build
docker run \
    --platform linux/arm64 \
    --rm \
    -v "$(pwd)/build/pi-build:/output" \
    tropxmotion-pi:latest \
    cp /output/tropxmotion-pi.tar.gz /output/

echo -e "${GREEN}✅ Build extracted to: build/pi-build/tropxmotion-pi.tar.gz${NC}"
echo ""

# Offer to deploy
echo -e "${YELLOW}📤 Step 3/3: Deploy to Raspberry Pi?${NC}"
read -p "Enter Pi hostname (default: pi.local, or press Enter to skip): " PI_HOST

if [ -n "$PI_HOST" ]; then
    PI_USER="${PI_USER:-pek}"
else
    # Use default if user just pressed Enter but we want to deploy
    read -p "Deploy to default pi.local? (y/N) " -n 1 -r
    echo
    if [[ $REPLY =~ ^[Yy]$ ]]; then
        PI_HOST="pi.local"
        PI_USER="pek"
    fi
fi

if [ -n "$PI_HOST" ]; then
    echo ""
    echo -e "${YELLOW}Deploying to $PI_USER@$PI_HOST...${NC}"

    scp build/pi-build/tropxmotion-pi.tar.gz "$PI_USER@$PI_HOST:~/"

    ssh "$PI_USER@$PI_HOST" bash << 'REMOTE'
cd ~
mkdir -p tropxmotion
tar xzf tropxmotion-pi.tar.gz -C tropxmotion/
rm tropxmotion-pi.tar.gz
cd tropxmotion
chmod +x start.sh

echo ""
echo "✅ Deployment complete!"
echo ""
echo "To run the app:"
echo "  cd ~/tropxmotion"
echo "  ./start.sh"
echo ""
REMOTE

    echo ""
    echo -e "${GREEN}========================================${NC}"
    echo -e "${GREEN}✅ Done! App is ready on your Pi${NC}"
    echo -e "${GREEN}========================================${NC}"
else
    echo ""
    echo -e "${GREEN}========================================${NC}"
    echo -e "${GREEN}✅ Build complete!${NC}"
    echo -e "${GREEN}========================================${NC}"
    echo ""
    echo "To deploy manually:"
    echo "  scp build/pi-build/tropxmotion-pi.tar.gz pi@tropxpi.local:~/"
    echo "  ssh pi@tropxpi.local"
    echo "  tar xzf tropxmotion-pi.tar.gz"
    echo "  cd tropxmotion && ./start.sh"
fi
echo ""
