-- Add missing planId column to Subscription table
ALTER TABLE "Subscription" ADD COLUMN IF NOT EXISTS "planId" TEXT;

-- Add missing code column to Plan table
ALTER TABLE "Plan" ADD COLUMN IF NOT EXISTS "code" TEXT;

-- Create unique index on Plan.code
CREATE UNIQUE INDEX IF NOT EXISTS "Plan_code_key" ON "Plan"("code");

-- Create index on Subscription.planId
CREATE INDEX IF NOT EXISTS "Subscription_planId_idx" ON "Subscription"("planId");

-- Add foreign key constraint for Subscription.planId -> Plan.id
DO $$ 
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint 
        WHERE conname = 'Subscription_planId_fkey'
    ) THEN
        ALTER TABLE "Subscription" 
        ADD CONSTRAINT "Subscription_planId_fkey" 
        FOREIGN KEY ("planId") REFERENCES "Plan"("id") 
        ON DELETE SET NULL ON UPDATE CASCADE;
    END IF;
END $$;

