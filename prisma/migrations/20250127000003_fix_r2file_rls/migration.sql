-- Create RLS policies for R2File table
CREATE POLICY "Users can view their own R2Files" ON "R2File" FOR SELECT USING ("ownerAuthId" = auth.uid()::text);
CREATE POLICY "Users can insert their own R2Files" ON "R2File" FOR INSERT WITH CHECK ("ownerAuthId" = auth.uid()::text);
CREATE POLICY "Users can update their own R2Files" ON "R2File" FOR UPDATE USING ("ownerAuthId" = auth.uid()::text);
CREATE POLICY "Users can delete their own R2Files" ON "R2File" FOR DELETE USING ("ownerAuthId" = auth.uid()::text);
