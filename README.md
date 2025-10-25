# DayGen Backend

A comprehensive NestJS backend service for the DayGen AI-powered content generation platform. Provides image and video generation, user authentication, payment processing, and gallery management.

## 🚀 Features

### Image Generation
- **FLUX Models**: Flux Pro 1.1, Ultra, Kontext Pro/Max via BFL API
- **Gemini 2.5 Flash**: Google's latest text-to-image model with experimental preview support
- **Ideogram V3**: Advanced text-to-image with turbo mode and style presets
- **Recraft v2/v3**: Professional image generation with multiple styles and editing capabilities
- **Reve**: Fast image generation, editing, and remixing with advanced controls
- **Qwen Image**: Alibaba's text-to-image generation via DashScope API
- **Runway Gen-4**: Professional image generation with cinematic quality
- **DALL·E 3**: OpenAI's image generation API with multiple model variants
- **Luma AI**: Dream Shaper, Realistic Vision, and Photon models for various styles

### Video Generation
- **Veo 3**: Google's latest cinematic video generation with advanced prompting
- **Kling**: Advanced video generation with multiple models and camera controls
- **Runway Gen-4 Video**: Professional video generation with style consistency
- **Wan 2.2**: Alibaba's text-to-video generation with high quality output
- **Hailuo 02**: MiniMax video generation with frame control and editing
- **Seedance 1.0 Pro**: High-quality video generation with smooth motion
- **Luma Ray 2**: Professional video generation with advanced features

### Core Services
- **Authentication**: Supabase Auth + JWT with Google OAuth
- **Payment Processing**: Stripe integration for credits and subscriptions
- **File Storage**: Cloudflare R2 for image/video storage
- **Job Queue**: Google Cloud Tasks for async processing
- **Gallery Management**: User galleries with R2 storage
- **Usage Tracking**: Credit system and usage analytics
- **WebSocket Support**: Real-time job status updates

## 🛠️ Tech Stack

- **Framework**: NestJS with TypeScript
- **Database**: PostgreSQL with Prisma ORM
- **Storage**: Cloudflare R2
- **Queue**: Google Cloud Tasks
- **Payments**: Stripe
- **Auth**: Supabase + JWT
- **Deployment**: Google Cloud Run

## 🚀 Quick Start

1. **Install dependencies**:
   ```bash
   npm install
   ```

2. **Set up environment variables** (see Environment Configuration below)

3. **Set up database**:
   ```bash
   npx prisma generate
   npx prisma db push
   ```

4. **Run development server**:
   ```bash
   npm run start:dev
   ```

## 📝 Environment Configuration

### Required Variables
- `DATABASE_URL` - PostgreSQL connection string
- `DIRECT_URL` - Direct PostgreSQL connection for migrations
- `JWT_SECRET` - Secret for JWT token signing
- `SUPABASE_URL` - Supabase project URL
- `SUPABASE_ANON_KEY` - Supabase anonymous key
- `SUPABASE_SERVICE_ROLE_KEY` - Supabase service role key

### Image Generation Providers
Configure API keys for the providers you want to use:

- `BFL_API_KEY` - Black Forest Labs (FLUX models)
- `GEMINI_API_KEY` - Google Gemini 2.5 Flash
- `IDEOGRAM_API_KEY` - Ideogram V3
- `DASHSCOPE_API_KEY` - Alibaba Qwen Image
- `RUNWAY_API_KEY` - Runway Gen-4
- `OPENAI_API_KEY` - OpenAI DALL·E
- `REVE_API_KEY` - Reve image generation
- `RECRAFT_API_KEY` - Recraft v2/v3
- `LUMA_API_KEY` - Luma AI models

### Storage & Services
- `R2_ACCOUNT_ID` - Cloudflare R2 account ID
- `R2_ACCESS_KEY_ID` - R2 access key
- `R2_SECRET_ACCESS_KEY` - R2 secret key
- `R2_BUCKET_NAME` - R2 bucket name
- `R2_PUBLIC_URL` - R2 public URL

### Payment Processing
- `STRIPE_SECRET_KEY` - Stripe secret key
- `STRIPE_WEBHOOK_SECRET` - Stripe webhook secret
- `FRONTEND_URL` - Frontend URL for redirects

### Google Cloud Tasks
- `GOOGLE_CLOUD_PROJECT_ID` - GCP project ID
- `GOOGLE_APPLICATION_CREDENTIALS` - Service account key path (local development only)

## 🔗 API Endpoints

### Authentication
- `POST /api/auth/signup` - Create account with email/password
- `POST /api/auth/login` - Login with email/password
- `POST /api/auth/google` - Google OAuth login
- `POST /api/auth/oauth-callback` - Handle OAuth callbacks
- `GET /api/auth/me` - Get current user profile
- `POST /api/auth/forgot-password` - Request password reset
- `POST /api/auth/reset-password` - Reset password

### User Management
- `GET /api/users/me` - Get current user profile
- `POST /api/users/me` - Create user profile
- `PATCH /api/users/me` - Update user profile

### Image Generation
- `POST /api/image/gemini` - Gemini 2.5 Flash image generation
- `POST /api/image/flux` - FLUX model generation
- `POST /api/image/gemini` - Gemini generation
- `POST /api/image/ideogram` - Ideogram generation
- `POST /api/image/runway` - Runway generation
- `POST /api/image/recraft` - Recraft generation
- `POST /api/image/reve` - Reve generation
- `POST /api/image/luma` - Luma AI generation

### Video Generation
- `POST /api/video/veo` - Google Veo 3 generation
- `POST /api/video/kling` - Kling video generation
- `POST /api/video/runway` - Runway video generation
- `POST /api/video/luma` - Luma video generation

### Job Management
- `POST /api/jobs/image-generation` - Create image generation job
- `POST /api/jobs/video-generation` - Create video generation job
- `GET /api/jobs/:jobId` - Get job status
- `GET /api/jobs` - List user jobs

### Gallery & Files
- `GET /api/r2files` - List user files
- `POST /api/r2files` - Upload file to R2
- `DELETE /api/r2files/:id` - Delete file

### Payments
- `POST /api/payments/create-checkout` - Create Stripe checkout session
- `GET /api/payments/subscription` - Get user subscription
- `POST /api/payments/subscription/upgrade` - Upgrade subscription
- `POST /api/payments/cancel-subscription` - Cancel subscription
- `GET /api/payments/history` - Get payment history

### Health & Monitoring
- `GET /health` - Health check endpoint
- `GET /api/usage/events` - Usage analytics (admin only)

## 🧪 Testing

```bash
# Unit tests
npm run test

# E2E tests
npm run test:e2e

# Test coverage
npm run test:cov

# Linting
npm run lint

# Build
npm run build
```

## 📊 Database Schema

The application uses PostgreSQL with Prisma ORM. Key models include:

- **User**: User accounts with credits and profile info
- **R2File**: File metadata for Cloudflare R2 storage
- **Job**: Async job tracking for generation tasks
- **Payment**: Payment records and transactions
- **Subscription**: User subscription management
- **UsageEvent**: Credit usage tracking and analytics

## 🚀 Deployment

The application is designed to deploy on Google Cloud Run with:

1. **Database**: PostgreSQL (Supabase or Cloud SQL)
2. **Storage**: Cloudflare R2
3. **Queue**: Google Cloud Tasks
4. **Monitoring**: Built-in health checks and logging

See `docs/PRODUCTION_DEPLOYMENT.md` for detailed deployment instructions.

## 📚 Documentation

- [Development Guide](docs/DEVELOPMENT.md)
- [Production Deployment](docs/PRODUCTION_DEPLOYMENT.md)
- [Queue System](docs/QUEUE_SYSTEM.md)
- [Backup System](BACKUP_SYSTEM.md)
- [Google OAuth Setup](docs/GOOGLE_OAUTH_SETUP.md)
- [Stripe Setup](STRIPE_SETUP.md)

---

<p align="center">
  <a href="http://nestjs.com/" target="blank"><img src="https://nestjs.com/img/logo-small.svg" width="120" alt="Nest Logo" /></a>
</p>

[circleci-image]: https://img.shields.io/circleci/build/github/nestjs/nest/master?token=abc123def456
[circleci-url]: https://circleci.com/gh/nestjs/nest

  <p align="center">A progressive <a href="http://nodejs.org" target="_blank">Node.js</a> framework for building efficient and scalable server-side applications.</p>
    <p align="center">
<a href="https://www.npmjs.com/~nestjscore" target="_blank"><img src="https://img.shields.io/npm/v/@nestjs/core.svg" alt="NPM Version" /></a>
<a href="https://www.npmjs.com/~nestjscore" target="_blank"><img src="https://img.shields.io/npm/l/@nestjs/core.svg" alt="Package License" /></a>
<a href="https://www.npmjs.com/~nestjscore" target="_blank"><img src="https://img.shields.io/npm/dm/@nestjs/common.svg" alt="NPM Downloads" /></a>
<a href="https://circleci.com/gh/nestjs/nest" target="_blank"><img src="https://img.shields.io/circleci/build/github/nestjs/nest/master" alt="CircleCI" /></a>
<a href="https://discord.gg/G7Qnnhy" target="_blank"><img src="https://img.shields.io/badge/discord-online-brightgreen.svg" alt="Discord"/></a>
<a href="https://opencollective.com/nest#backer" target="_blank"><img src="https://opencollective.com/nest/backers/badge.svg" alt="Backers on Open Collective" /></a>
<a href="https://opencollective.com/nest#sponsor" target="_blank"><img src="https://opencollective.com/nest/sponsors/badge.svg" alt="Sponsors on Open Collective" /></a>
  <a href="https://paypal.me/kamilmysliwiec" target="_blank"><img src="https://img.shields.io/badge/Donate-PayPal-ff3f59.svg" alt="Donate us"/></a>
    <a href="https://opencollective.com/nest#sponsor"  target="_blank"><img src="https://img.shields.io/badge/Support%20us-Open%20Collective-41B883.svg" alt="Support us"></a>
  <a href="https://twitter.com/nestframework" target="_blank"><img src="https://img.shields.io/twitter/follow/nestframework.svg?style=social&label=Follow" alt="Follow us on Twitter"></a>
</p>
  <!--[![Backers on Open Collective](https://opencollective.com/nest/backers/badge.svg)](https://opencollective.com/nest#backer)
  [![Sponsors on Open Collective](https://opencollective.com/nest/sponsors/badge.svg)](https://opencollective.com/nest#sponsor)-->

## Description

[Nest](https://github.com/nestjs/nest) framework TypeScript starter repository.

## Project setup

```bash
$ npm install
```

## Compile and run the project

```bash
# development
$ npm run start

# watch mode
$ npm run start:dev

# production mode
$ npm run start:prod
```

## Run tests

```bash
# unit tests
$ npm run test

# e2e tests
$ npm run test:e2e

# test coverage
$ npm run test:cov
```

## Deployment

When you're ready to deploy your NestJS application to production, there are some key steps you can take to ensure it runs as efficiently as possible. Check out the [deployment documentation](https://docs.nestjs.com/deployment) for more information.

If you are looking for a cloud-based platform to deploy your NestJS application, check out [Mau](https://mau.nestjs.com), our official platform for deploying NestJS applications on AWS. Mau makes deployment straightforward and fast, requiring just a few simple steps:

```bash
$ npm install -g @nestjs/mau
$ mau deploy
```

With Mau, you can deploy your application in just a few clicks, allowing you to focus on building features rather than managing infrastructure.

## Resources

Check out a few resources that may come in handy when working with NestJS:

- Visit the [NestJS Documentation](https://docs.nestjs.com) to learn more about the framework.
- For questions and support, please visit our [Discord channel](https://discord.gg/G7Qnnhy).
- To dive deeper and get more hands-on experience, check out our official video [courses](https://courses.nestjs.com/).
- Deploy your application to AWS with the help of [NestJS Mau](https://mau.nestjs.com) in just a few clicks.
- Visualize your application graph and interact with the NestJS application in real-time using [NestJS Devtools](https://devtools.nestjs.com).
- Need help with your project (part-time to full-time)? Check out our official [enterprise support](https://enterprise.nestjs.com).
- To stay in the loop and get updates, follow us on [X](https://x.com/nestframework) and [LinkedIn](https://linkedin.com/company/nestjs).
- Looking for a job, or have a job to offer? Check out our official [Jobs board](https://jobs.nestjs.com).

## Support

Nest is an MIT-licensed open source project. It can grow thanks to the sponsors and support by the amazing backers. If you'd like to join them, please [read more here](https://docs.nestjs.com/support).

## Stay in touch

- Author - [Kamil Myśliwiec](https://twitter.com/kammysliwiec)
- Website - [https://nestjs.com](https://nestjs.com/)
- Twitter - [@nestframework](https://twitter.com/nestframework)

## License

Nest is [MIT licensed](https://github.com/nestjs/nest/blob/master/LICENSE).
