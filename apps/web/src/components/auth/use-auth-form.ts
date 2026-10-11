"use client";

import { useState } from "react";

type State = { pending: boolean; error: string | null };

/** POSTs JSON to an auth endpoint and surfaces the API's user-safe message. */
export function useAuthForm(endpoint: string, onSuccess: (data: unknown) => void) {
  const [state, setState] = useState<State>({ pending: false, error: null });

  async function submit(body: Record<string, unknown>) {
    setState({ pending: true, error: null });
    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data: unknown = await response.json().catch(() => null);
      if (!response.ok) {
        const message = (data as { error?: { message?: string } } | null)?.error
          ?.message;
        setState({
          pending: false,
          error: message ?? "Bir hata oluştu. Lütfen tekrar deneyin.",
        });
        return;
      }
      setState({ pending: false, error: null });
      onSuccess(data);
    } catch {
      setState({
        pending: false,
        error: "Bağlantı hatası. İnternet bağlantınızı kontrol edin.",
      });
    }
  }

  return { ...state, submit };
}
