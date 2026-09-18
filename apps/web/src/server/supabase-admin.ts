import { createClient } from "@supabase/supabase-js";

/** Client quyền service — CHỈ dùng phía server cho việc admin API (auth.admin.*, vd mời email).
 * KHÔNG BAO GIỜ lộ service key ra client. */
export const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { autoRefreshToken: false, persistSession: false } },
);
