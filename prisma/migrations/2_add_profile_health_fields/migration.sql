-- Add biologicalSex, height, weight, primaryGoal to client_profiles
ALTER TABLE "client_profiles" ADD COLUMN IF NOT EXISTS "biologicalSex" TEXT;
ALTER TABLE "client_profiles" ADD COLUMN IF NOT EXISTS "height" DOUBLE PRECISION;
ALTER TABLE "client_profiles" ADD COLUMN IF NOT EXISTS "weight" DOUBLE PRECISION;
ALTER TABLE "client_profiles" ADD COLUMN IF NOT EXISTS "primaryGoal" TEXT;
