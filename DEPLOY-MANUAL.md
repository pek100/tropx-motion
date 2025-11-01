# Manual Deploy to Raspberry Pi

Since `pi.local` is not resolving, here's how to deploy manually:

## Option 1: Deploy via PowerShell (Recommended)

Open **PowerShell** on Windows and run:

```powershell
cd E:\MyWebApps\Tropx\TropxMotion

# Try with pi.local first
ping pi.local

# If ping works, note the IP address shown, then:
$env:PI_HOST="pi.local"  # or use the IP like "192.168.1.100"
$env:PI_USER="pek"
bash scripts/deploy-to-pi.sh
```

You'll be prompted for the password (1234) during the process.

---

## Option 2: Find Pi's IP Address First

### On the Pi itself (if you have keyboard/monitor):
```bash
hostname -I
```

### From Windows:
1. Open your router's admin page (usually http://192.168.1.1 or http://192.168.0.1)
2. Look for "Connected Devices" or "DHCP Clients"
3. Find the Pi and note its IP address

### Then deploy with IP:
```powershell
cd E:\MyWebApps\Tropx\TropxMotion
$env:PI_HOST="192.168.1.XXX"  # Replace with actual IP
$env:PI_USER="pek"
bash scripts/deploy-to-pi.sh
```

---

## Option 3: Manual File Transfer + Build

If the script doesn't work, here's the manual process:

### Step 1: Transfer files via WinSCP or FileZilla
- Download WinSCP: https://winscp.net/
- Connect to: `pek@pi.local` (or IP address)
- Password: `1234`
- Upload the entire `E:\MyWebApps\Tropx\TropxMotion` folder to `/home/pek/tropxmotion`

### Step 2: SSH into Pi
```powershell
ssh pek@pi.local
# Or: ssh pek@192.168.1.XXX
# Password: 1234
```

### Step 3: Build on Pi
```bash
cd ~/tropxmotion

# Install dependencies (20-30 min on Pi 3B)
export NODE_OPTIONS="--max-old-space-size=512"
npm ci --production

# Build app (5-10 min)
npm run build:main
npm run build:renderer

# Run app
npm start
```

---

## Troubleshooting

### If `pi.local` doesn't work:
The Pi's mDNS/avahi service may not be running. Try:
```bash
# On the Pi:
sudo systemctl start avahi-daemon
sudo systemctl enable avahi-daemon
```

### If SSH asks for password every time:
Set up SSH keys for passwordless access:
```powershell
# On Windows:
ssh-keygen -t ed25519
ssh-copy-id pek@pi.local
```

---

## Quick Status Check

To check if everything is ready:

```bash
# Check if Pi is reachable:
ping pi.local

# Check if SSH works:
ssh pek@pi.local "echo 'Pi is accessible'"
```

If both work, the deployment script should work fine!
