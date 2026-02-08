#!/bin/bash
cd /home/kavia/workspace/code-generation/stock-insights-analyzer-234320-230808/stock_analyzer_frontend
npm run build
EXIT_CODE=$?
if [ $EXIT_CODE -ne 0 ]; then
   exit 1
fi

