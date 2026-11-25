-- Migration: Laboratory Processes Catalog Table (public.processes), Seed, Backfill, and RLS
-- Implements to centralize laboratory process management in PostgreSQL while
-- preserving full backward compatibility with public.documents.process_area and public.users.assigned_processes.

-- 1. Create public.processes catalog table
CREATE TABLE IF NOT EXISTS public.processes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL UNIQUE,
    description TEXT,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT check_processes_code_not_empty CHECK (BTRIM(code) <> ''),
    CONSTRAINT check_processes_name_not_empty CHECK (BTRIM(name) <> '')
);

COMMENT ON TABLE public.processes IS
    'Dynamic catalog of laboratory processes and operational areas for SGC-ISO9001 documents and users.';

COMMENT ON COLUMN public.processes.id IS
    'Unique UUID identifier for the laboratory process.';

COMMENT ON COLUMN public.processes.code IS
    'Normalized identifier stored in documents.process_area and users.assigned_processes (e.g., quimica_clinica).';

COMMENT ON COLUMN public.processes.name IS
    'Unique human-readable process name displayed in the UI.';

COMMENT ON COLUMN public.processes.description IS
    'Optional description detailing the scope of the laboratory process.';

COMMENT ON COLUMN public.processes.is_active IS
    'Soft-status flag indicating whether the process is active for new assignments.';

COMMENT ON COLUMN public.processes.created_at IS
    'Timestamp when the process record was created.';

COMMENT ON COLUMN public.processes.updated_at IS
    'Timestamp when the process record was last updated.';

-- 2. Performance index for active process dropdown and ordered catalog queries
CREATE INDEX IF NOT EXISTS idx_processes_active_name
    ON public.processes (is_active, name);

-- 3. Before-write trigger for name/code normalization and automatic updated_at tracking
CREATE OR REPLACE FUNCTION public.handle_processes_before_write()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
    NEW.name := BTRIM(NEW.name);

    IF NEW.code IS NULL OR BTRIM(NEW.code) = '' THEN
        NEW.code := COALESCE(
            NULLIF(
                TRIM(
                    BOTH '_' FROM REGEXP_REPLACE(
                        LOWER(TRANSLATE(NEW.name, 'ÁÉÍÓÚÜÑáéíóúüñ', 'AEIOUUNaeiouun')),
                        '[^a-z0-9]+',
                        '_',
                        'g'
                    )
                ),
                ''
            ),
            LOWER(NEW.name)
        );
    ELSE
        NEW.code := BTRIM(NEW.code);
    END IF;

    IF TG_OP = 'UPDATE' THEN
        NEW.updated_at := CURRENT_TIMESTAMP;
    END IF;

    RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.handle_processes_before_write() IS
    'Normalizes process name/code (generating an ASCII slug code when omitted) and updates updated_at on modification.';

DROP TRIGGER IF EXISTS tr_processes_before_write ON public.processes;
CREATE TRIGGER tr_processes_before_write
BEFORE INSERT OR UPDATE ON public.processes
FOR EACH ROW
EXECUTE FUNCTION public.handle_processes_before_write();

-- 4. Idempotent seed of existing laboratory processes (matching frontend PROCESS_AREAS)
INSERT INTO public.processes (code, name, description) VALUES
    ('quimica_clinica', 'Química Clínica', 'Procesos analíticos de química clínica y bioquímica.'),
    ('bacteriologia', 'Bacteriología', 'Procesos de microbiología y bacteriología clínica.'),
    ('guardia', 'Guardia', 'Procesos operativos de laboratorio de guardia y urgencias.'),
    ('hematologia', 'Hematología', 'Procesos analíticos de hematología y hemostasia.'),
    ('inmunologia', 'Inmunología', 'Procesos analíticos de inmunología y serología.'),
    ('control_calidad', 'Control de Calidad', 'Gestión de calidad, auditorías internas y aseguramiento ISO 9001.')
ON CONFLICT DO NOTHING;

-- 5. Idempotent backfill of any distinct process values already referenced in documents or users
WITH existing_process_values AS (
    SELECT BTRIM(d.process_area) AS raw_value
    FROM public.documents d
    WHERE d.process_area IS NOT NULL
      AND BTRIM(d.process_area) <> ''
    UNION
    SELECT BTRIM(proc) AS raw_value
    FROM public.users u
    CROSS JOIN LATERAL UNNEST(COALESCE(u.assigned_processes, ARRAY[]::TEXT[])) AS proc
    WHERE BTRIM(proc) <> ''
    UNION
    SELECT BTRIM(u.process_area) AS raw_value
    FROM public.users u
    WHERE u.process_area IS NOT NULL
      AND BTRIM(u.process_area) <> ''
)
INSERT INTO public.processes (code, name)
SELECT
    LOWER(ev.raw_value) AS code,
    ev.raw_value AS name
FROM existing_process_values ev
WHERE NOT EXISTS (
    SELECT 1
    FROM public.processes p
    WHERE LOWER(p.code) = LOWER(ev.raw_value)
       OR LOWER(p.name) = LOWER(ev.raw_value)
)
ON CONFLICT DO NOTHING;

-- 6. Enable Row Level Security (RLS) and role-based access policies
ALTER TABLE public.processes ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.processes FROM anon, public;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.processes TO authenticated;
GRANT ALL ON public.processes TO service_role;

-- All active authenticated users can read the laboratory process catalog
DROP POLICY IF EXISTS "processes_select_policy" ON public.processes;
CREATE POLICY "processes_select_policy"
ON public.processes
FOR SELECT
TO authenticated
USING (
    public.is_active_user()
);

-- Only active ADMIN users can create processes
DROP POLICY IF EXISTS "processes_insert_policy" ON public.processes;
CREATE POLICY "processes_insert_policy"
ON public.processes
FOR INSERT
TO authenticated
WITH CHECK (
    public.has_role('ADMIN')
);

-- Only active ADMIN users can update processes
DROP POLICY IF EXISTS "processes_update_policy" ON public.processes;
CREATE POLICY "processes_update_policy"
ON public.processes
FOR UPDATE
TO authenticated
USING (
    public.has_role('ADMIN')
)
WITH CHECK (
    public.has_role('ADMIN')
);

-- Only active ADMIN users can delete processes
DROP POLICY IF EXISTS "processes_delete_policy" ON public.processes;
CREATE POLICY "processes_delete_policy"
ON public.processes
FOR DELETE
TO authenticated
USING (
    public.has_role('ADMIN')
);
