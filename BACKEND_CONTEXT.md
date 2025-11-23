# Backend Context & Architecture Status

> **Purpose**: This file tracks the current architectural state and recent major refactors for context.

## Recent Refactors (Nov 2025)

### 1. Generation Orchestrator Pattern
- **Goal**: Centralize generation logic, validation, and credit management.
- **Component**: `GenerationOrchestrator` (`src/generation/generation.orchestrator.ts`)
- **Flow**:
    1. **Reserve Credits**: `UsageService.reserveCredits` (Status: RESERVED)
    2. **Execute**: `GenerationService.dispatch` (Provider specific logic)
    3. **Persist**: `GeneratedAssetService.persistResult` (R2 upload + DB record)
    4. **Capture Credits**: `UsageService.captureCredits` (Status: COMPLETED)
    5. **Refund (on error)**: `UsageService.releaseCredits` (Status: CANCELLED)

### 2. Generated Asset Service
- **Goal**: Unify asset persistence logic across all providers.
- **Component**: `GeneratedAssetService` (`src/generation/generated-asset.service.ts`)
- **Features**:
    - Handles Data URLs, Remote URLs, and Base64.
    - Uploads to Cloudflare R2.
    - Creates `R2File` records in Prisma.
    - Deduplicates assets via hash.

### 3. Transactional Credits
- **Goal**: Prevent credit loss on failed generations and ensure accurate usage tracking.
- **Component**: `UsageService` (`src/usage/usage.service.ts`)
- **Mechanism**: Two-phase commit style (Reserve -> Capture/Release) using `UsageEvent` status.

## Current Focus
- maintaining the orchestrator pattern for new providers.
- ensuring all new generation features use `GeneratedAssetService`.
- monitoring credit reservation/release consistency.