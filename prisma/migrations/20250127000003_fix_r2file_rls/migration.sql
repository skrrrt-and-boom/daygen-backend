-- Create RLS policies for R2File table (only if auth schema exists)
DO $$
BEGIN
    -- Check if auth schema exists before creating RLS policies
    IF EXISTS (SELECT 1 FROM information_schema.schemata WHERE schema_name = 'auth') THEN
        -- Enable RLS on R2File table
        ALTER TABLE "R2File" ENABLE ROW LEVEL SECURITY;
        
        -- Create RLS policies
        CREATE POLICY "Users can view their own R2Files" ON "R2File" FOR SELECT USING ("ownerAuthId" = auth.uid()::text);
        CREATE POLICY "Users can insert their own R2Files" ON "R2File" FOR INSERT WITH CHECK ("ownerAuthId" = auth.uid()::text);
        CREATE POLICY "Users can update their own R2Files" ON "R2File" FOR UPDATE USING ("ownerAuthId" = auth.uid()::text);
        CREATE POLICY "Users can delete their own R2Files" ON "R2File" FOR DELETE USING ("ownerAuthId" = auth.uid()::text);
    END IF;
END $$;
