import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';

export async function createServerClientInstance() {
  const cookieStore = await cookies();
  
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        get(name: string) {
          return cookieStore.get(name)?.value;
        },
        set(name: string, value: string, options: any) {
          try {
            cookieStore.set(name, value, options);
          } catch (error) {
            // This can fail in Server Components, but is safe to ignore in Route Handlers
          }
        },
        remove(name: string, options: any) {
          try {
            cookieStore.delete(name);
          } catch (error) {
            // This can fail in Server Components, but is safe to ignore in Route Handlers
          }
        },
      },
    }
  );
}