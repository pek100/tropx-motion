
  # Detect Pi model and apply optimizations
  TOTAL_MEM=$(free -m | grep Mem | awk '{print $2}')
  if [ "$TOTAL_MEM" -lt 2048 ]; then
      export NODE_OPTIONS="--max-old-space-size=400"
      echo "?? Pi 3B detected - Using 400MB memory limit"
  else
      export NODE_OPTIONS="--max-old-space-size=1024"
      echo "?? Pi 4/5 detected - Using 1024MB memory limit"
  fi

  # Ensure display is set
  if [ -z "$DISPLAY" ]; then
      export DISPLAY=:0
  fi

  echo "?? Starting TropX Motion..."
  echo "   Memory limit: $NODE_OPTIONS"
  echo "   Display: $DISPLAY"
  echo ""

  # Run the app
  npx electron .
