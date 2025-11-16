#!/bin/sh

echo "🚀 Starting DayGen Backend..."

# Set default port if not provided
export PORT=${PORT:-3000}

echo "📊 Running database migrations..."
npx prisma migrate deploy || {
  echo "⚠️  Migration failed, but continuing with startup..."
  echo "   This might be due to missing environment variables or database connectivity issues."
}

echo "🔧 Generating Prisma client..."
npx prisma generate || {
  echo "⚠️  Prisma generate failed, but continuing with startup..."
}

echo "🌐 Starting server on port $PORT..."
exec node dist/main.js
