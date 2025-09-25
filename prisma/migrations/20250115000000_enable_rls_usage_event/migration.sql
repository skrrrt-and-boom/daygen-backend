-- Enable RLS on UsageEvent table
ALTER TABLE "UsageEvent" ENABLE ROW LEVEL SECURITY;

-- Create policies for UsageEvent table
CREATE POLICY "Users can view their own usage events" ON "UsageEvent"
    FOR SELECT USING (auth.uid()::text = "userAuthId");

CREATE POLICY "Users can insert their own usage events" ON "UsageEvent"
    FOR INSERT WITH CHECK (auth.uid()::text = "userAuthId");

CREATE POLICY "Users can update their own usage events" ON "UsageEvent"
    FOR UPDATE USING (auth.uid()::text = "userAuthId");

CREATE POLICY "Users can delete their own usage events" ON "UsageEvent"
    FOR DELETE USING (auth.uid()::text = "userAuthId");
