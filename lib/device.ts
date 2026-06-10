"use client";

// A stable anonymous id for this browser, used to allow exactly one live
// rating per dish per device (the owner chose "anyone can rate" — this is the
// light spam brake: a prankster can't stack fifty 1-stars on one dish from
// the same phone). Falls back to a throwaway id if storage is blocked.
export const getDeviceId = (): string => {
  try {
    const KEY = "lfh_device_id";
    let id = localStorage.getItem(KEY);
    if (!id) {
      id = crypto.randomUUID();
      localStorage.setItem(KEY, id);
    }
    return id;
  } catch {
    return `anon-${Math.random().toString(36).slice(2, 12)}`;
  }
};
