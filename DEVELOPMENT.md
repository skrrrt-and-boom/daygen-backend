# Development Guide

## Quick Start

### Using Safe Development Scripts

The backend now includes safe development scripts that automatically handle port conflicts:

```bash
# Start development server (automatically kills existing process if needed)
npm run start:dev:safe

# Kill any existing process on port 3000
npm run dev:kill

# Check if port 3000 is in use
npm run dev:check

# Restart development server
npm run dev:restart
```

### Manual Commands

If you prefer to manage the server manually:

```bash
# Kill existing process on port 3000
kill -9 $(lsof -ti:3000)

# Start development server
npm run start:dev
```

## Common Issues

### Port Already in Use (EADDRINUSE)

If you see the error `Error: listen EADDRINUSE: address already in use :::3000`, it means another process is using port 3000.

**Solution 1: Use the safe script**
```bash
npm run start:dev:safe
```

**Solution 2: Manual fix**
```bash
# Find and kill the process
lsof -ti:3000 | xargs kill -9

# Then start the server
npm run start:dev
```

## Environment Variables

Make sure to set up your environment variables in `.env` file:

```bash
# Required
DATABASE_URL=your_database_url
JWT_SECRET=your_jwt_secret

# API Keys (optional, only for the providers you want to use)
BFL_API_KEY=your_bfl_key
GEMINI_API_KEY=your_gemini_key
IDEOGRAM_API_KEY=your_ideogram_key
REVE_API_KEY=your_reve_key
RECRAFT_API_KEY=your_recraft_key
# ... other API keys as needed
```

## API Endpoints

- `GET /api` - Health check
- `POST /api/unified-generate` - Image generation
- `GET /api/gallery` - User gallery
- `POST /api/gallery` - Save image to gallery
- `GET /api/auth/me` - Get current user
- `POST /api/auth/login` - User login
- `POST /api/auth/signup` - User registration

## Troubleshooting

### Server won't start
1. Check if port 3000 is in use: `npm run dev:check`
2. Kill existing process: `npm run dev:kill`
3. Try starting again: `npm run start:dev:safe`

### API errors
- Check that required environment variables are set
- Verify API keys are valid and have proper permissions
- Check server logs for detailed error messages

### Database issues
- Ensure PostgreSQL is running
- Check DATABASE_URL is correct
- Run migrations if needed: `npx prisma migrate deploy`
