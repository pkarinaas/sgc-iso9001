-- SGC ISO 9001 - INITIAL DATABASE SCHEMA MIGRATION

-- 1. System Roles Table
CREATE TABLE IF NOT EXISTS public.roles (
    id SERIAL PRIMARY KEY,
    name VARCHAR(50) UNIQUE NOT NULL,
    description TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Default roles insertion for Quality Management
INSERT INTO public.roles (name, description) VALUES
('ADMIN', 'General administrator of the Quality Management System'),
('EDITOR', 'Personnel authorized to draft and propose documents'),
('REVIEWER', 'Personnel in charge of technical document review'),
('APPROVER', 'Management or quality manager with approval authority'),
('VIEWER', 'Personnel with read and consultation-only permissions')
ON CONFLICT (name) DO NOTHING;

-- 2. Users Table
CREATE TABLE IF NOT EXISTS public.users (
    id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    email VARCHAR(255) UNIQUE NOT NULL,
    full_name VARCHAR(150) NOT NULL,
    role_id INT REFERENCES public.roles(id) ON DELETE SET DEFAULT DEFAULT 5,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 3. Documents Table
CREATE TABLE IF NOT EXISTS public.documents (
    id SERIAL PRIMARY KEY,
    code VARCHAR(50) UNIQUE NOT NULL,
    title VARCHAR(255) NOT NULL,
    version INT DEFAULT 00,
    status VARCHAR(30) DEFAULT 'DRAFT',
    file_url TEXT NOT NULL,
    creator_id UUID REFERENCES public.users(id) ON DELETE SET NULL,
    updater_id UUID REFERENCES public.users(id) ON DELETE SET NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 4. Function to automatically update the updated_at timestamp
CREATE OR REPLACE FUNCTION update_modified_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- 5. Trigger to execute the function before any update on documents
DROP TRIGGER IF EXISTS set_timestamp ON public.documents;
CREATE TRIGGER set_timestamp
BEFORE UPDATE ON public.documents
FOR EACH ROW
EXECUTE FUNCTION update_modified_column();