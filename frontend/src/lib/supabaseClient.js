import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  console.warn(
    'Supabase environment variables are missing. Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in frontend/.env.',
  );
}

export const supabase =
  supabaseUrl && supabaseAnonKey
    ? createClient(supabaseUrl, supabaseAnonKey)
    : {
        auth: {
          getSession: async () => ({ data: { session: null } }),
          onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
          signInWithPassword: async () => ({ error: new Error('Supabase not configured') }),
          signUp: async () => ({ error: new Error('Supabase not configured') }),
          signOut: async () => ({ error: new Error('Supabase not configured') }),
        },
        from: () => ({
          select: async () => ({ data: [], error: new Error('Supabase not configured') }),
          insert: async () => ({ error: new Error('Supabase not configured') }),
          delete: async () => ({ error: new Error('Supabase not configured') }),
          eq: () => ({
            select: async () => ({ data: [], error: new Error('Supabase not configured') }),
            delete: async () => ({ error: new Error('Supabase not configured') }),
          }),
          order: () => ({
            eq: () => ({
              select: async () => ({ data: [], error: new Error('Supabase not configured') }),
            }),
          }),
        }),
      };
