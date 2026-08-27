-- Add deployment_type column to deployments table
ALTER TABLE deployments 
ADD COLUMN IF NOT EXISTS deployment_type VARCHAR(50) DEFAULT 'standard';

-- Add comment
COMMENT ON COLUMN deployments.deployment_type IS 'Type of deployment: standard, rollback, hotfix, etc.';

-- Create index for faster queries
CREATE INDEX IF NOT EXISTS idx_deployments_type ON deployments(deployment_type);

-- Update existing deployments to have standard type
UPDATE deployments 
SET deployment_type = 'standard' 
WHERE deployment_type IS NULL;
