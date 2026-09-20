import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

// True only when both environment variables made it into the build.
export const configOk = Boolean(url && anonKey);

// createClient throws on an empty url, which would blank the whole app before
// anything renders. The placeholder keeps it alive so App.jsx can show a real
// message instead of a dark empty screen.
export const supabase = createClient(
  url || 'https://placeholder.supabase.co',
  anonKey || 'placeholder-key'
);
