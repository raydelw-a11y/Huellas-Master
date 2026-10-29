#!/bin/bash
cd "$(dirname "$0")"
echo "🎬 Iniciando Huellas Master en http://localhost:4200 ..."
(sleep 2 && open "http://localhost:4200") &
npm run dev
