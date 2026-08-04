/**
 * Supabase 클라이언트.
 *
 * 설계 정본: `API데이터설계.md` §2(키 관리) · §5.8(RLS)
 *
 * 두 종류를 분리해 둡니다.
 *  - `getBrowserClient()` — anon 키. 브라우저·서버 어디서나 쓸 수 있고 RLS 가 걸립니다.
 *  - `getServiceClient()` — service_role 키. **서버에서만** 씁니다. RLS 를 통과하므로
 *    사용자 입력이 닿는 경로에서 쓰지 않습니다.
 *
 * 쓰기는 전부 API Route 를 거칩니다(§5.8). 브라우저에서 직접 쓰면 서버측 검증
 * (부산 경계 · 길이 제한 · 이미지 검사)을 우회할 수 있기 때문입니다.
 */

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

export class SupabaseConfigError extends Error {
  constructor(missing: string[]) {
    super(
      `Supabase 환경변수가 설정되지 않았습니다: ${missing.join(", ")}. ` +
        "`.env.example` 을 `.env.local` 로 복사한 뒤 값을 채워 주세요.",
    );
    this.name = "SupabaseConfigError";
  }
}

function readEnv(name: string): string | null {
  const value = process.env[name];
  return value && value.trim() !== "" ? value.trim() : null;
}

/** 값이 채워져 있는지만 확인합니다. 화면이 안내 문구를 고를 때 씁니다. */
export function supabaseStatus(): {
  hasUrl: boolean;
  hasAnonKey: boolean;
  hasServiceKey: boolean;
  ready: boolean;
} {
  const hasUrl = readEnv("NEXT_PUBLIC_SUPABASE_URL") !== null;
  const hasAnonKey = readEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY") !== null;
  const hasServiceKey = readEnv("SUPABASE_SERVICE_ROLE_KEY") !== null;
  return { hasUrl, hasAnonKey, hasServiceKey, ready: hasUrl && hasAnonKey };
}

let browserClient: SupabaseClient | null = null;

/** anon 키 클라이언트. RLS 로 보호되는 읽기 전용 경로에 씁니다. */
export function getBrowserClient(): SupabaseClient {
  if (browserClient) return browserClient;

  const url = readEnv("NEXT_PUBLIC_SUPABASE_URL");
  const anonKey = readEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY");

  const missing: string[] = [];
  if (!url) missing.push("NEXT_PUBLIC_SUPABASE_URL");
  if (!anonKey) missing.push("NEXT_PUBLIC_SUPABASE_ANON_KEY");
  if (missing.length > 0) throw new SupabaseConfigError(missing);

  browserClient = createClient(url as string, anonKey as string, {
    auth: { persistSession: false },
  });
  return browserClient;
}

let serviceClient: SupabaseClient | null = null;

/**
 * service_role 키 클라이언트 — 서버 전용.
 * API Route · 크론 · 백필 스크립트에서만 호출합니다.
 */
export function getServiceClient(): SupabaseClient {
  if (typeof window !== "undefined") {
    throw new Error(
      "getServiceClient() 는 서버에서만 호출할 수 있습니다. service_role 키가 브라우저로 나가면 안 됩니다.",
    );
  }
  if (serviceClient) return serviceClient;

  const url = readEnv("NEXT_PUBLIC_SUPABASE_URL");
  const serviceKey = readEnv("SUPABASE_SERVICE_ROLE_KEY");

  const missing: string[] = [];
  if (!url) missing.push("NEXT_PUBLIC_SUPABASE_URL");
  if (!serviceKey) missing.push("SUPABASE_SERVICE_ROLE_KEY");
  if (missing.length > 0) throw new SupabaseConfigError(missing);

  serviceClient = createClient(url as string, serviceKey as string, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return serviceClient;
}
