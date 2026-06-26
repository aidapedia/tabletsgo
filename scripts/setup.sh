#!/bin/bash
# Quick start script for TabletGo real database setup

set -e

echo "🚀 TabletGo - Real Database Setup"
echo "=================================="
echo ""

# Check Node.js
if ! command -v node &> /dev/null; then
    echo "❌ Node.js is not installed. Please install Node.js 16+."
    exit 1
fi

echo "✅ Node.js found: $(node --version)"
echo ""

# Install dependencies
echo "📦 Installing dependencies..."
npm install
echo "✅ Dependencies installed"
echo ""

# Create demo database
echo "📊 Creating demo SQLite database..."
if [ ! -f "demo.db" ]; then
    node scripts/create-demo-db.js
else
    echo "   demo.db already exists, skipping..."
fi
echo ""

# Show next steps
echo "🎉 Setup complete!"
echo ""
echo "To start the app, run one of these commands:"
echo ""
echo "  Option 1 (Recommended): npm run dev:all"
echo "    • Starts both frontend (5173) and backend (3000)"
echo ""
echo "  Option 2: npm run dev"
echo "    • Starts only frontend (requires backend running separately)"
echo ""
echo "  Option 3: npm run server"
echo "    • Starts only backend server (requires frontend running separately)"
echo ""
echo "📖 Open http://localhost:5173 in your browser once everything is running!"
echo ""
echo "🎨 Default Demo Connection:"
echo "   Name: Demo Database"
echo "   Type: SQLite"
echo "   File: ./demo.db"
echo ""
