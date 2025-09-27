-- Update existing users with 0 credits to 3 free credits
UPDATE "User" SET credits = 3 WHERE credits = 0;

-- Note: Default credits for new users is handled by Prisma schema (default(3))
