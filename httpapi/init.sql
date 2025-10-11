-- PostgreSQL initialization script for b3nd
-- This script sets up the database schema for b3nd storage

-- Create b3nd_data table for storing URI-based data
CREATE TABLE IF NOT EXISTS b3nd_data (
    uri VARCHAR(2048) PRIMARY KEY,
    data JSONB NOT NULL,
    timestamp BIGINT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_b3nd_data_uri_prefix ON b3nd_data (uri);
CREATE INDEX IF NOT EXISTS idx_b3nd_data_timestamp ON b3nd_data (timestamp);
CREATE INDEX IF NOT EXISTS idx_b3nd_data_created_at ON b3nd_data (created_at);

-- Create function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Create trigger for updated_at
DROP TRIGGER IF EXISTS update_b3nd_data_updated_at ON b3nd_data;
CREATE TRIGGER update_b3nd_data_updated_at
    BEFORE UPDATE ON b3nd_data
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- Create a function for upsert operations (used by b3nd write operations)
CREATE OR REPLACE FUNCTION b3nd_upsert(
    p_uri VARCHAR,
    p_data JSONB,
    p_timestamp BIGINT
)
RETURNS VOID AS $$
BEGIN
    INSERT INTO b3nd_data (uri, data, timestamp)
    VALUES (p_uri, p_data, p_timestamp)
    ON CONFLICT (uri) DO UPDATE SET
        data = EXCLUDED.data,
        timestamp = EXCLUDED.timestamp,
        updated_at = CURRENT_TIMESTAMP;
END;
$$ LANGUAGE plpgsql;

-- Grant permissions to b3nd_user (will be created by docker-compose)
GRANT ALL PRIVILEGES ON TABLE b3nd_data TO b3nd_user;
GRANT EXECUTE ON FUNCTION b3nd_upsert(VARCHAR, JSONB, BIGINT) TO b3nd_user;

-- Create a sample schema for testing
INSERT INTO b3nd_data (uri, data, timestamp) VALUES
    ('users://test/user1', '{"name": "Test User", "email": "test@example.com"}', extract(epoch from now()) * 1000),
    ('posts://test/post1', '{"title": "Hello World", "content": "This is a test post"}', extract(epoch from now()) * 1000)
ON CONFLICT (uri) DO NOTHING;

-- Create a view for easier querying by program/protocol
CREATE OR REPLACE VIEW b3nd_data_by_program AS
SELECT
    uri,
    split_part(uri, '://', 1) as program,
    split_part(uri, '://', 2) as path,
    data,
    timestamp,
    created_at,
    updated_at
FROM b3nd_data;

-- Create index on program for faster queries
CREATE INDEX IF NOT EXISTS idx_b3nd_data_program ON b3nd_data (split_part(uri, '://', 1));