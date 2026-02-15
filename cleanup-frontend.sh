#!/bin/bash

# DEXA Frontend Cleanup Script
# Organizes frontend folder: moves old UI system files to archive
# Usage: bash cleanup-frontend.sh

cd /Users/ritawangyixuan/Desktop/WashUMed26/frontend || exit

echo "🧹 Cleaning up frontend directory..."
echo ""

# Create archive directory for old files
echo "📁 Creating old_ui directory..."
mkdir -p old_ui

# Move old HTML files
echo "📄 Moving old HTML files..."
[ -f "index.html" ] && mv index.html old_ui/
[ -f "dexa-upload.html" ] && mv dexa-upload.html old_ui/
[ -f "dexa-advanced.html" ] && mv dexa-advanced.html old_ui/
[ -f "statstests.html" ] && mv statstests.html old_ui/

# Move old JavaScript
echo "🔧 Moving old JavaScript..."
[ -f "js/main.js" ] && mv js/main.js old_ui/

# Move old CSS
echo "🎨 Moving old CSS..."
[ -f "css/style.css" ] && mv css/style.css old_ui/

# Move old components/variants
echo "📦 Moving old components..."
[ -f "components/DexaUploaderHansver.jsx" ] && mv components/DexaUploaderHansver.jsx old_ui/

# Move old React demo
echo "📦 Moving old React demo..."
[ -d "src/old_demo" ] && mv src/old_demo old_ui/

# Move CDN demo folder
echo "📦 Moving CDN demo..."
[ -d "cdn-demo" ] && mv cdn-demo old_ui/

# Move Rhistory file
echo "🗑️  Moving misc files..."
[ -f "js/.Rhistory" ] && mv js/.Rhistory old_ui/

echo ""
echo "✅ Frontend cleanup complete!"
echo ""
echo "📊 New Structure:"
echo "frontend/"
echo "├── dexa-teal-upload.html      ← MAIN UPLOAD"
echo "├── public/"
echo "│   └── visualization.html     ← MAIN VISUALIZATION"
echo "├── package.json"
echo "├── d3/"
echo "├── js/"
echo "│   ├── jquery-3.6.1.min.js"
echo "│   └── bootstrap/"
echo "├── css/"
echo "│   └── bootstrap/"
echo "├── exports/                   ← OUTPUT FOLDER"
echo "├── src/"
echo "│   ├── DexaUploader.jsx"
echo "│   └── DexaUploader.css"
echo "├── components/                ← ACTIVE COMPONENTS"
echo "│   ├── DexaUploader.jsx"
echo "│   └── DexaUploader.css"
echo "└── old_ui/                    ← ARCHIVED OLD FILES"
echo "    ├── index.html"
echo "    ├── dexa-upload.html"
echo "    ├── dexa-advanced.html"
echo "    ├── statstests.html"
echo "    ├── main.js"
echo "    ├── style.css"
echo "    ├── cdn-demo/"
echo "    ├── src/"
echo "    └── ..."
echo ""
echo "🎉 Ready to use! Your new system is clean."