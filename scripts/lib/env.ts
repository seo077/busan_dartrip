/**
 * 스크립트용 환경변수 로더.
 *
 * Next 개발 서버는 `.env.local` 을 자동으로 읽지만, `scripts/` 는 Next 밖에서 도는
 * 순수 Node 프로세스라 스스로 읽어야 합니다. 그래서 모든 스크립트가 첫 줄에서
 * `loadEnv()` 를 부릅니다.
 *
 * 값이 비어 있을 때 **예외로 죽지 않고 무엇을 채워야 하는지 안내**하는 것이 이 파일의 목적입니다
 * (뼈대 배포 화면과 같은 방식). 사용자는 `.env.local` 하나만 갖추면 되고, 덜 갖춰진 상태에서
 * 실행해도 다음에 무엇을 하면 되는지가 화면에 남습니다.
 *
 * 실행 위치는 **저장소 루트**를 전제합니다(`npm run ...` 이 그렇게 동작합니다).
 */

import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { config as loadDotenv } from "dotenv";

/** 저장소 루트. npm 스크립트로 실행하면 언제나 package.json 이 있는 폴더입니다. */
export const REPO_ROOT = process.cwd();

const ENV_FILES = [".env.local", ".env"];

let loadedFiles: string[] | null = null;

/** `.env.local` → `.env` 순으로 읽습니다. 이미 설정된 값은 덮어쓰지 않습니다. */
export function loadEnv(): string[] {
  if (loadedFiles) return loadedFiles;

  const found: string[] = [];
  for (const name of ENV_FILES) {
    const path = resolve(REPO_ROOT, name);
    if (!existsSync(path)) continue;
    loadDotenv({ path, override: false, quiet: true });
    found.push(name);
  }
  loadedFiles = found;
  return found;
}

export function readEnv(name: string): string | null {
  const value = process.env[name];
  return value && value.trim() !== "" ? value.trim() : null;
}

export function hasEnv(name: string): boolean {
  return readEnv(name) !== null;
}

/** 환경변수 한 칸의 설명 — 안내 문구를 만드는 데 씁니다. */
export interface EnvNeed {
  name: string;
  purpose: string;
  where: string;
}

export const ENV_NEEDS: Record<string, EnvNeed> = {
  DATA_GO_KR_KEY: {
    name: "DATA_GO_KR_KEY",
    purpose: "공공데이터포털 서비스키 (관광공사·부산명소 공통)",
    where: "https://www.data.go.kr 마이페이지 > 일반 인증키",
  },
  NEXT_PUBLIC_SUPABASE_URL: {
    name: "NEXT_PUBLIC_SUPABASE_URL",
    purpose: "Supabase 프로젝트 주소",
    where: "Supabase 프로젝트 > Settings > API > Project URL",
  },
  SUPABASE_SERVICE_ROLE_KEY: {
    name: "SUPABASE_SERVICE_ROLE_KEY",
    purpose: "Supabase 쓰기 권한 키 (서버·스크립트 전용)",
    where: "Supabase 프로젝트 > Settings > API > service_role",
  },
};

export interface EnvReport {
  ok: boolean;
  missing: EnvNeed[];
  present: string[];
}

/** 필요한 환경변수가 다 있는지 확인만 합니다. 던지지 않습니다. */
export function checkEnv(names: string[]): EnvReport {
  loadEnv();
  const missing: EnvNeed[] = [];
  const present: string[] = [];
  for (const name of names) {
    if (hasEnv(name)) present.push(name);
    else
      missing.push(
        ENV_NEEDS[name] ?? { name, purpose: "(설명 없음)", where: "(확인 필요)" },
      );
  }
  return { ok: missing.length === 0, missing, present };
}

/** 빠진 환경변수를 사람이 읽을 수 있는 안내로 바꿉니다. */
export function describeMissing(missing: EnvNeed[]): string {
  const lines = [
    "환경변수가 아직 비어 있습니다. 저장소 루트의 `.env.local` 을 채운 뒤 다시 실행해 주세요.",
    "",
    "  Windows PowerShell:  Copy-Item .env.example .env.local",
    "  macOS / Linux:       cp .env.example .env.local",
    "",
    "채워야 하는 값",
  ];
  for (const need of missing) {
    lines.push(`  - ${need.name}`);
    lines.push(`      쓰임: ${need.purpose}`);
    lines.push(`      발급: ${need.where}`);
  }
  return lines.join("\n");
}
