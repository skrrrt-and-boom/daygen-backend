-- AlterTable: Add stripeSubscriptionId to Payment for deduplication
ALTER TABLE "Payment" ADD COLUMN "stripeSubscriptionId" TEXT;

-- CreateIndex: Create unique constraint to prevent duplicate payments per subscription
CREATE UNIQUE INDEX "Payment_userId_stripeSubscriptionId_key" ON "Payment"("userId", "stripeSubscriptionId");
