-- PostgreSQL schema for b3nd storage
-- This script creates the database schema for PostgreSQL client implementation
-- It should be executed by the client when initializing the database connection

-- Create b3nd_data table for storing URI-based data
CREATE TABLE IF NOT EXISTS {{tablePrefix}}_data (
    uri VARCHAR(2048) PRIMARY KEY,
    data JSONB NOT NULL,
    timestamp BIGINT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_{{tablePrefix}}_data_uri_prefix ON {{tablePrefix}}_data (uri);
CREATE INDEX IF NOT EXISTS idx_{{tablePrefix}}_data_timestamp ON {{tablePrefix}}_data (timestamp);
CREATE INDEX IF NOT EXISTS idx_{{tablePrefix}}_data_created_at ON {{tablePrefix}}_data (created_at);

-- Create function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_{{tablePrefix}}_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Create trigger for updated_at
DROP TRIGGER IF EXISTS update_{{tablePrefix}}_data_updated_at ON {{tablePrefix}}_data;
CREATE TRIGGER update_{{tablePrefix}}_data_updated_at
    BEFORE UPDATE ON {{tablePrefix}}_data
    FOR EACH ROW
    EXECUTE FUNCTION update_{{tablePrefix}}_updated_at_column();

-- Create a function for upsert operations (used by b3nd write operations)
CREATE OR REPLACE FUNCTION {{tablePrefix}}_upsert(
    p_uri VARCHAR,
    p_data JSONB,
    p_timestamp BIGINT
)
RETURNS VOID AS $$
BEGIN
    INSERT INTO {{tablePrefix}}_data (uri, data, timestamp)
    VALUES (p_uri, p_data, p_timestamp)
    ON CONFLICT (uri) DO UPDATE SET
        data = EXCLUDED.data,
        timestamp = EXCLUDED.timestamp,
        updated_at = CURRENT_TIMESTAMP;
END;
$$ LANGUAGE plpgsql;

-- Grant permissions (this should be done by the database administrator)
-- GRANT ALL PRIVILEGES ON TABLE {{tablePrefix}}_data TO {{databaseUser}};
-- GRANT EXECUTE ON FUNCTION {{tablePrefix}}_upsert(VARCHAR, JSONB, BIGINT) TO {{databaseUser}};

-- Create a view for easier querying by program/protocol
CREATE OR REPLACE VIEW {{tablePrefix}}_data_by_program AS
SELECT
    uri,
    split_part(uri, '://', 1) as program,
    split_part(uri, '://', 2) as path,
    data,
    timestamp,
    created_at,
    updated_at
FROM {{tablePrefix}}_data;

-- Create index on program for faster queries
CREATE INDEX IF NOT EXISTS idx_{{tablePrefix}}_data_program ON {{tablePrefix}}_data (split_part(uri, '://', 1));