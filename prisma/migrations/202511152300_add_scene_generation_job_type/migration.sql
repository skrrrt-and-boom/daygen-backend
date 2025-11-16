-- Add new job type for queued scene generations
ALTER TYPE "JobType" ADD VALUE IF NOT EXISTS 'SCENE_GENERATION';

