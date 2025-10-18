# Google OAuth Setup Guide

This guide will help you set up Google OAuth authentication for your DayGen application.

## Prerequisites

1. A Google Cloud Platform account
2. A Supabase project
3. Your application running locally

## Step 1: Create Google OAuth Credentials

1. Go to the [Google Cloud Console](https://console.cloud.google.com/)
2. Create a new project or select an existing one
3. Enable the Google+ API:
   - Go to "APIs & Services" > "Library"
   - Search for "Google+ API" and enable it
4. Create OAuth 2.0 credentials:
   - Go to "APIs & Services" > "Credentials"
   - Click "Create Credentials" > "OAuth 2.0 Client IDs"
   - Choose "Web application" as the application type
   - Add authorized redirect URIs:
     - `http://localhost:3000/api/auth/google/callback` (for backend)
     - `http://localhost:5173/auth/callback` (for frontend)
   - Note down your Client ID and Client Secret

## Step 2: Configure Supabase

1. Go to your Supabase dashboard
2. Navigate to "Authentication" > "Providers"
3. Enable Google provider:
   - Toggle "Enable Google provider"
   - Enter your Google Client ID and Client Secret
   - Set the redirect URL to: `http://localhost:5173/auth/callback`

## Step 3: Configure Environment Variables

Run the setup script to configure your environment:

```bash
cd daygen-backend
./setup-env.sh
```

When prompted, enter:
- Your Supabase Anon Key
- Your Supabase Service Role Key
- Your Google Client ID
- Your Google Client Secret

## Step 4: Test the Integration

1. Start your backend server:
   ```bash
   cd daygen-backend
   npm run start:dev
   ```

2. Start your frontend server:
   ```bash
   cd daygen0
   npm run dev
   ```

3. Test Google OAuth:
   - Go to `http://localhost:5173`
   - Click "Sign in with Google"
   - Complete the OAuth flow
   - Verify you're redirected back to the app

## Troubleshooting

### Common Issues

1. **"This app isn't verified" warning**:
   - This is normal for development
   - Click "Advanced" > "Go to [Your App Name] (unsafe)"

2. **Redirect URI mismatch**:
   - Ensure the redirect URIs in Google Console match exactly
   - Check for trailing slashes and http vs https

3. **Invalid client error**:
   - Verify your Client ID and Client Secret are correct
   - Ensure the Google+ API is enabled

4. **CORS errors**:
   - Make sure your frontend URL is added to CORS settings
   - Check that the backend is running on the correct port

### Debug Steps

1. Check browser console for errors
2. Check backend logs for authentication errors
3. Verify environment variables are loaded correctly
4. Test the OAuth URL generation:
   ```bash
   curl -X POST http://localhost:3000/api/auth/google
   ```

## Production Deployment

For production, update the redirect URIs to use your production domain:

1. In Google Console, add production redirect URIs:
   - `https://yourdomain.com/api/auth/google/callback`
   - `https://yourdomain.com/auth/callback`

2. In Supabase, update the redirect URL to your production frontend URL

3. Update your environment variables with production URLs

## Security Notes

- Never commit your Client Secret to version control
- Use environment variables for all sensitive data
- Regularly rotate your OAuth credentials
- Monitor OAuth usage in Google Console
- Set up proper CORS policies for production

## API Endpoints

The following endpoints are available for Google OAuth:

- `POST /api/auth/google` - Initiate Google OAuth flow
- `GET /api/auth/google/callback` - Handle Google OAuth callback
- `GET /api/auth/callback` - Handle Supabase auth callbacks
- `POST /api/auth/oauth-callback` - Handle frontend OAuth callbacks

## Support

If you encounter issues:

1. Check the [Google OAuth documentation](https://developers.google.com/identity/protocols/oauth2)
2. Review the [Supabase Auth documentation](https://supabase.com/docs/guides/auth)
3. Check the application logs for detailed error messages
