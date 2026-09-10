"use client";

import { useState, useActionState } from "react";
import { updateCustomerAction } from "@/app/app/bookings/actions";
import type { Database } from "@/types/supabase";

type Customer = Database["public"]["Tables"]["customers"]["Row"] & {
  booking_count: number;
};

export default function CustomerDetailClient({ customer }: { customer: Customer }) {
  const [notes, setNotes] = useState(customer.notes ?? "");
  const [state, formAction, isPending] = useActionState(updateCustomerAction, undefined);
  return (
    <form action={formAction} className="mt-3 space-y-2">
      <input type="hidden" name="customer_id" value={customer.id} />
      <label
        htmlFor={`c-notes-${customer.id}`}
        className="mb-1 block text-xs font-medium text-neutral-600"
      >
        Note interne
      </label>
      <textarea
        id={`c-notes-${customer.id}`}
        name="notes"
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
        maxLength={2000}
        rows={6}
        className="w-full rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm focus:border-neutral-500 focus:outline-none focus:ring-2 focus:ring-neutral-500/20"
        aria-describedby={`c-notes-${customer.id}-hint`}
      />
      <div
        id={`c-notes-${customer.id}-hint`}
        className="flex items-center justify-between text-[11px] text-neutral-400"
        aria-live="polite"
      >
        <span>Max 2000 caratteri. Le note non sono pubbliche.</span>
        <span>{notes.length}/2000</span>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="submit"
          disabled={isPending}
          className="rounded-md bg-neutral-900 px-4 py-1.5 text-sm font-medium text-white hover:bg-neutral-800 disabled:opacity-60 focus:outline-none focus:ring-2 focus:ring-neutral-500/30"
        >
          Salva note
        </button>
        {state && state.ok === true ? (
          <div className="text-xs text-emerald-700" role="status">
            Note salvate.
          </div>
        ) : state && state.ok === false ? (
          <div className="text-xs text-red-700" role="alert">
            {state.error}
          </div>
        ) : null}
      </div>
    </form>
  );
}
