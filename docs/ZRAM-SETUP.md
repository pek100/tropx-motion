# ZRAM Setup Guide for TropXMotion

## Overview

ZRAM (compressed RAM) reduces SD card wear on Raspberry Pi by storing frequently-written data (swap, logs, temp files) in compressed RAM instead of on the SD card. This significantly extends SD card lifespan and improves performance.

## Why Use ZRAM?

### Problems with Default Raspberry Pi Setup

- **SD Card Wear**: Default swap file writes constantly to SD card, reducing lifespan
- **Poor Performance**: SD card swap is extremely slow compared to RAM
- **Application Load Stress**: Electron apps like TropXMotion generate many writes during startup and operation
- **Log Writes**: System logs continuously write to SD card

### Benefits of ZRAM

- ✅ **Reduced SD Card Wear**: 90% fewer write cycles to SD card
- ✅ **Better Performance**: RAM-based swap is 100x faster than SD card
- ✅ **More Usable RAM**: 2-3x compression ratio means 1GB zram uses ~350MB actual RAM
- ✅ **No Hardware Changes**: Pure software solution
- ✅ **Boot Protection**: Logs and temp files in RAM reduce boot-time SD writes

## What Gets Configured

### 1. ZRAM Swap
- **Size**: 50% of total RAM (compresses to ~20% actual usage)
- **Algorithm**: LZ4 (best performance on ARM)
- **Replaces**: SD card swap file (/var/swap)
- **Benefit**: Fast swap with zero SD card writes

### 2. ZRAM /tmp Directory
- **Size**: 50% of total RAM
- **Purpose**: Temporary files stored in compressed RAM
- **Benefit**: Eliminates temp file writes to SD card

### 3. ZRAM /var/log
- **Size**: 40MB compressed
- **Purpose**: Log files stored in RAM, synced periodically to disk
- **Benefit**: Reduces constant log writes
- **Note**: ⚠️ Logs may be lost on unexpected power loss

### 4. Kernel Parameters
- `vm.swappiness=100`: Aggressive swapping (OK since zram is fast)
- `vm.vfs_cache_pressure=500`: Aggressive cache reclaim
- `vm.dirty_background_ratio=1`: Start writing early to reduce burst writes
- `vm.dirty_ratio=50`: Allow more dirty pages before forcing sync
- `vm.page-cluster=0`: Optimize for compressed swap

## Installation

### Prerequisites

- Raspberry Pi running Raspberry Pi OS (Debian-based)
- Root access (sudo)
- Internet connection

### Quick Install

```bash
cd /home/pek/tropxmotion
sudo bash scripts/setup-zram.sh
```

The script will:
1. ✓ Check system requirements
2. ✓ Disable default SD card swap
3. ✓ Install zram-config tool
4. ✓ Configure optimal settings
5. ✓ Set kernel parameters
6. ✓ Start and enable zram service
7. ✓ Verify installation

**Installation time**: ~2-3 minutes

**No reboot required** - ZRAM activates immediately!

## Verification

### Check if ZRAM is Working

```bash
bash scripts/verify-zram.sh
```

This runs 9 verification checks:
1. ✓ ZRAM kernel module loaded
2. ✓ zram-config service active
3. ✓ ZRAM devices created
4. ✓ ZRAM swap active
5. ✓ SD card swap disabled
6. ✓ Configuration file exists
7. ✓ Kernel parameters applied
8. ✓ Memory usage stats
9. ✓ Compression statistics

### Manual Verification Commands

```bash
# View ZRAM devices and compression stats
zramctl

# Check swap (should show zram, not /var/swap)
swapon --show

# Check memory usage
free -h

# Check service status
sudo systemctl status zram-config

# View configuration
cat /etc/ztab

# Check kernel parameters
sysctl vm.swappiness vm.dirty_background_ratio vm.dirty_ratio
```

### Expected Output Examples

**Good zramctl output:**
```
NAME       ALGORITHM DISKSIZE DATA COMPR TOTAL STREAMS MOUNTPOINT
/dev/zram0 lz4           1.8G   4K   74B   12K       4 [SWAP]
/dev/zram1 lz4           1.8G   0B   0B   12K       4 /tmp
/dev/zram2 lz4            40M 324K 108K  404K       4 /var/log
```

**Good swapon output:**
```
NAME       TYPE SIZE USED PRIO
/dev/zram0 partition 1.8G   0B  100
```

## Configuration

### Main Config File: `/etc/ztab`

```bash
# Syntax: <type> <parameters>
# Types: swap, dir, log

# ZRAM Swap
swap    50%    lz4

# ZRAM /tmp
dir     /tmp   50%    lz4

# ZRAM Logs
log     /var/log    40M    lz4
```

### Customization Options

**Change swap size:**
```bash
sudo nano /etc/ztab
# Change: swap 50% lz4
# To:     swap 1G   lz4   (for 1GB fixed size)
```

**Change compression algorithm:**
- `lz4` - Fast, best for most use cases (recommended)
- `lzo` - Slightly better compression, slower
- `zstd` - Best compression, slowest

**Apply changes:**
```bash
sudo systemctl restart zram-config
```

## Monitoring

### Check Compression Efficiency

```bash
# View detailed stats
for dev in /sys/block/zram*/mm_stat; do
    echo "$(basename $(dirname $dev)):"
    cat $dev
done
```

### Monitor Memory Usage Over Time

```bash
# Install htop for easy monitoring
sudo apt install htop
htop

# Or use watch with free
watch -n 1 free -h
```

### Check SD Card Write Reduction

```bash
# Before ZRAM (baseline)
sync && echo 3 | sudo tee /proc/sys/vm/drop_caches && \
iostat -d /dev/mmcblk0 5 12

# After ZRAM (compare writes)
iostat -d /dev/mmcblk0 5 12
```

## Troubleshooting

### ZRAM Service Won't Start

```bash
# Check status
sudo systemctl status zram-config

# View logs
sudo journalctl -u zram-config -n 50

# Check kernel module
lsmod | grep zram
```

### Old Swap Still Active

```bash
# Disable dphys-swapfile
sudo dphys-swapfile swapoff
sudo systemctl disable dphys-swapfile

# Disable all swap
sudo swapoff -a

# Restart zram
sudo systemctl restart zram-config
```

### Out of Memory Issues

If you experience OOM (Out of Memory) errors:

```bash
# Option 1: Increase zram swap size
sudo nano /etc/ztab
# Change: swap 50% lz4
# To:     swap 100% lz4

# Option 2: Reduce zram usage for /tmp
sudo nano /etc/ztab
# Change: dir /tmp 50% lz4
# To:     dir /tmp 25% lz4

# Apply changes
sudo systemctl restart zram-config
```

### Logs Lost on Power Loss

This is expected behavior. ZRAM logs are synced periodically but may be lost on unexpected shutdown.

**If you need persistent logs:**
```bash
# Option 1: Disable zram for logs
sudo nano /etc/ztab
# Comment out: #log /var/log 40M lz4

# Option 2: Use log2ram instead (more persistent)
# See: https://github.com/azlux/log2ram
```

## Uninstallation

If you need to remove ZRAM:

```bash
# Stop and disable service
sudo systemctl stop zram-config
sudo systemctl disable zram-config

# Remove zram-config
sudo rm -rf /usr/local/bin/zram-config /etc/ztab

# Re-enable default swap
sudo systemctl enable dphys-swapfile
sudo systemctl start dphys-swapfile

# Remove kernel parameters
sudo rm /etc/sysctl.d/99-zram.conf

# Reboot
sudo reboot
```

## Performance Impact

### Expected Metrics

| Metric | Before ZRAM | After ZRAM | Improvement |
|--------|-------------|------------|-------------|
| SD card writes/min | ~500-1000 | ~50-100 | 90% reduction |
| Swap latency | ~100ms | ~1ms | 100x faster |
| RAM usage | 100% | 120-130% | Compression gain |
| Boot time | Same | Same | No change |
| App load time | Same/Better | Better | Less I/O wait |

### Raspberry Pi Model Recommendations

| Model | RAM | Recommended ZRAM Swap | Notes |
|-------|-----|----------------------|-------|
| RPi 3B | 1GB | 50% (512MB) | Safe, leaves 500MB for apps |
| RPi 4 (2GB) | 2GB | 50% (1GB) | Ideal configuration |
| RPi 4 (4GB) | 4GB | 50% (2GB) | Plenty of headroom |
| RPi 4 (8GB) | 8GB | 25% (2GB) | Don't need more |
| RPi 5 | 4-8GB | 50% | Best performance |

## Best Practices

1. ✅ **Monitor First Week**: Check `free -h` and `zramctl` daily after installation
2. ✅ **Use UPS**: Power loss may lose recent logs (use UPS for critical systems)
3. ✅ **Regular Backups**: ZRAM doesn't replace backups
4. ✅ **Update Regularly**: Keep zram-config updated
5. ✅ **Check Compression**: Good compression ratio is 2-3x

## Technical Details

### How ZRAM Works

1. **Kernel Module**: Linux kernel provides zram block device driver
2. **Compression**: Data compressed with LZ4 before storing in RAM
3. **Block Device**: Acts like a disk but stored in RAM
4. **Transparent**: Applications don't know they're using compressed RAM
5. **No CPU Impact**: LZ4 is extremely fast on modern ARM CPUs

### Compression Ratio Explained

- **Original Data**: 1GB of swap activity
- **Compressed**: ~350MB actual RAM usage
- **Ratio**: 2.86x compression
- **Result**: Effectively 2.86GB of usable swap from 1GB RAM

### Why LZ4 Compression?

- **Speed**: ~2.5 GB/s compression on Raspberry Pi 4
- **Efficiency**: 2-3x compression ratio
- **Low CPU**: <5% CPU usage during active swapping
- **ARM Optimized**: NEON SIMD acceleration on ARM

## References

- **zram-config GitHub**: https://github.com/ecdye/zram-config
- **Linux ZRAM Docs**: https://www.kernel.org/doc/Documentation/blockdev/zram.txt
- **LZ4 Algorithm**: https://github.com/lz4/lz4
- **SD Card Longevity**: https://raspberrypi.stackexchange.com/questions/169

## Support

If you encounter issues:

1. Run verification script: `bash scripts/verify-zram.sh`
2. Check service logs: `sudo journalctl -u zram-config -n 100`
3. Check kernel logs: `dmesg | grep -i zram`
4. Review configuration: `cat /etc/ztab`

## Changelog

### v1.0.0 (2025-11-13)
- ✅ Initial zram integration for TropXMotion
- ✅ Automated installation script
- ✅ Verification script
- ✅ Optimized configuration for Electron apps
- ✅ Kernel parameter tuning for SD card longevity
