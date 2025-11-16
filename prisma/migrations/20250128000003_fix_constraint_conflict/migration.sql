-- Fix constraint conflict by dropping and recreating if it exists
-- This handles the case where the constraint already exists

-- Drop the constraint if it exists
ALTER TABLE "R2File" DROP CONSTRAINT IF EXISTS "R2File_ownerAuthId_fkey";

-- Recreate the constraint
ALTER TABLE "R2File" ADD CONSTRAINT "R2File_ownerAuthId_fkey" 
FOREIGN KEY ("ownerAuthId") REFERENCES "User"("authUserId") ON DELETE CASCADE ON UPDATE CASCADE;
