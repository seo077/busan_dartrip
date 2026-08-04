/**
 * 익명 기기 식별과 오늘 던진 횟수 — 브라우저 저장소만 씁니다.
 *
 * 설계 정본: `화면구성도.md` §3.2-6("오늘 N번째", 자정 초기화) / D-9(로그인 없음) · D-16(횟수 제한 없음)
 *
 * v1 에는 로그인이 없습니다(D-9). "오늘 몇 번째" 는 서버에 남길 값이 아니라
 * **이 기기에서 오늘 몇 번 던졌는지**이므로 localStorage 로 충분합니다.
 * 기기 식별자는 나중에 카카오 로그인이 붙을 때를 대비해 `anon:` 접두를 그대로 씁니다(AD-11).
 *
 * 저장소를 못 쓰는 환경(시크릿 모드 일부·차단 설정)에서도 화면이 멈추지 않도록
 * 모든 접근을 try 로 감싸고, 실패하면 0 을 돌려줍니다.
 */

const DEVICE_KEY = "dartrip.device";
const COUNT_KEY = "dartrip.throws";

function storage(): Storage | null {
  try {
    if (typeof window === "undefined") return null;
    return window.localStorage;
  } catch {
    return null;
  }
}

/** 로컬 기준 오늘 날짜 (YYYY-MM-DD). 자정이 지나면 값이 바뀌어 횟수가 초기화됩니다. */
function today(): string {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

/** `anon:<uuid>` 형태의 기기 식별자. 없으면 만들어 저장합니다 (AD-11). */
export function deviceRef(): string {
  const store = storage();
  const fallback = "anon:unknown";
  if (!store) return fallback;

  try {
    const saved = store.getItem(DEVICE_KEY);
    if (saved) return saved;

    const uuid =
      typeof crypto !== "undefined" && "randomUUID" in crypto
        ? crypto.randomUUID()
        : Math.random().toString(36).slice(2) + Date.now().toString(36);

    const ref = `anon:${uuid}`;
    store.setItem(DEVICE_KEY, ref);
    return ref;
  } catch {
    return fallback;
  }
}

/** 오늘 던진 횟수. 날짜가 바뀌었으면 0 입니다. */
export function todayThrowCount(): number {
  const store = storage();
  if (!store) return 0;
  try {
    const raw = store.getItem(COUNT_KEY);
    if (!raw) return 0;
    const parsed = JSON.parse(raw) as { date?: string; count?: number };
    return parsed.date === today() ? Math.max(0, Number(parsed.count) || 0) : 0;
  } catch {
    return 0;
  }
}

/** 한 번 던진 것을 기록하고 갱신된 횟수를 돌려줍니다. 상한은 없습니다(D-16). */
export function recordThrow(): number {
  const next = todayThrowCount() + 1;
  const store = storage();
  if (store) {
    try {
      store.setItem(COUNT_KEY, JSON.stringify({ date: today(), count: next }));
    } catch {
      // 저장에 실패해도 던지기 자체는 계속됩니다.
    }
  }
  return next;
}
