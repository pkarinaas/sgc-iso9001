-- 1. Ensure RLS is enabled on both tables
ALTER TABLE public.roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;

-- 2. Helper function to check if the current authenticated user is ADMIN
-- (Uses SECURITY DEFINER to avoid infinite recursion when querying public.users)
CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS BOOLEAN AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.users u
    JOIN public.roles r ON u.role_id = r.id
    WHERE u.id = auth.uid()
      AND r.name = 'ADMIN'
      AND u.is_active = TRUE
  );
$$ LANGUAGE sql SECURITY DEFINER STABLE;

-- 3. Policies for public.roles (All authenticated users can read roles)
DROP POLICY IF EXISTS "Allow authenticated users to read roles" ON public.roles;
CREATE POLICY "Allow authenticated users to read roles"
ON public.roles
FOR SELECT
TO authenticated
USING (true);

-- 4. Policies for public.users
-- 4a. Authenticated users can read all users (needed for employee directory & document traceability)
DROP POLICY IF EXISTS "Allow authenticated users to read users" ON public.users;
CREATE POLICY "Allow authenticated users to read users"
ON public.users
FOR SELECT
TO authenticated
USING (true);

-- 4b. Only active ADMIN users can insert new employee records
DROP POLICY IF EXISTS "Allow admins to insert users" ON public.users;
CREATE POLICY "Allow admins to insert users"
ON public.users
FOR INSERT
TO authenticated
WITH CHECK (public.is_admin());

-- 4c. Only active ADMIN users can update employee records (role changes & logical deletion)
DROP POLICY IF EXISTS "Allow admins to update users" ON public.users;
CREATE POLICY "Allow admins to update users"
ON public.users
FOR UPDATE
TO authenticated
USING (public.is_admin())
WITH CHECK (public.is_admin());