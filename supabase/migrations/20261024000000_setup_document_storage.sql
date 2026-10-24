-- 1. Assign the creator_id to the authenticated user by default
ALTER TABLE public.documents ALTER COLUMN creator_id SET DEFAULT auth.uid();

-- 2. Enable RLS on public.documents
ALTER TABLE public.documents ENABLE ROW LEVEL SECURITY;

-- 3. RLS policies for public.documents
-- Allow reading documents to all authenticated users (to view them in the list)
DROP POLICY IF EXISTS "Permitir lectura de documentos a usuarios autenticados" ON public.documents;
CREATE POLICY "Permitir lectura de documentos a usuarios autenticados"
ON public.documents
FOR SELECT
TO authenticated
USING (true);

-- Allow authenticated users to create documents
DROP POLICY IF EXISTS "Permitir crear documentos a usuarios autenticados" ON public.documents;
CREATE POLICY "Permitir crear documentos a usuarios autenticados"
ON public.documents
FOR INSERT
TO authenticated
WITH CHECK (true);

-- Allow authenticated users to update documents
DROP POLICY IF EXISTS "Permitir actualizar documentos a usuarios autenticados" ON public.documents;
CREATE POLICY "Permitir actualizar documentos a usuarios autenticados"
ON public.documents
FOR UPDATE
TO authenticated
USING (true)
WITH CHECK (true);

-- 4. Policies for Storage (bucket 'sgc-files')
-- Allow authenticated users to upload files to the 'sgc-files' bucket
DROP POLICY IF EXISTS "Permitir subida a usuarios autenticados" ON storage.objects;
CREATE POLICY "Permitir subida a usuarios autenticados" 
ON storage.objects FOR INSERT TO authenticated 
WITH CHECK (bucket_id = 'sgc-files');

DROP POLICY IF EXISTS "Permitir actualización de archivos a usuarios autenticados" ON storage.objects;
CREATE POLICY "Permitir actualización de archivos a usuarios autenticados" 
ON storage.objects FOR UPDATE TO authenticated 
USING (bucket_id = 'sgc-files');

-- Allow authenticated users to read files
DROP POLICY IF EXISTS "Permitir lectura de archivos a usuarios autenticados" ON storage.objects;
CREATE POLICY "Permitir lectura de archivos a usuarios autenticados" 
ON storage.objects FOR SELECT TO authenticated 
USING (bucket_id = 'sgc-files');
