// Shared class strings so the auth pages look identical without a component
// layer. Focus rings are kept visible on purpose — these are tap targets on
// phones and the keyboard path matters too.
export const inputClass =
  "w-full rounded-lg border border-white/10 bg-surface px-3 py-2 text-ink outline-none placeholder:text-muted/50 focus:border-accent focus:ring-2 focus:ring-accent/30";

export const labelClass = "flex flex-col gap-1.5 text-sm text-muted";

export const buttonClass =
  "rounded-lg bg-accent px-4 py-2.5 font-medium text-bg transition-opacity hover:opacity-90 active:opacity-75";
