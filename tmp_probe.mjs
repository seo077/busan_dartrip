import "dotenv/config";
import { createClient } from "@supabase/supabase-js";

const db = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } },
);

const sg = await db.from("sigungu").select("*").order("code");
console.log("sigungu", sg.error ?? sg.data.length, JSON.stringify(sg.data?.slice(0, 3)));

const st = await db.from("dart_pool_stats").select("*").order("sigungu_code");
console.log("stats rows", st.error ?? st.data.length);
console.log(JSON.stringify(st.data));

const pl = await db.from("places").select("id", { count: "exact", head: true });
console.log("places", pl.error ?? pl.count);

const one = await db.from("places").select("*").eq("status", "published").limit(1);
console.log("sample place", JSON.stringify(one.data?.[0], null, 1));

const rpc = await db.rpc("throw_dart", { p_scope: null, p_theme: null });
console.log("throw_dart", rpc.error ?? JSON.stringify(rpc.data));

const rpc2 = await db.rpc("throw_dart", { p_scope: null, p_theme: "activity" });
console.log("throw_dart activity", rpc2.error ?? JSON.stringify(rpc2.data));
