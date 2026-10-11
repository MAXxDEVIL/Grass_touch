import Link from "next/link";
import { Suspense } from "react";
import { buttonClass, inputClass, labelClass } from "@/components/ui";
import { AUTH_ERRORS } from "@/lib/auth";

export default function RegisterPage({ searchParams }: PageProps<"/register">) {
  return (
    <main className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center gap-6 px-6 py-12">
      <h1 className="text-2xl font-semibold">Create account</h1>

      <Suspense fallback={null}>
        <ErrorNote searchParams={searchParams} />
      </Suspense>

      <form
        method="post"
        action="/api/auth/register"
        className="flex flex-col gap-4"
      >
        <label className={labelClass}>
          Username
          <input
            className={inputClass}
            name="username"
            autoComplete="username"
            autoCapitalize="none"
            required
          />
        </label>
        <label className={labelClass}>
          Password
          <input
            className={inputClass}
            name="password"
            type="password"
            autoComplete="new-password"
            minLength={8}
            required
          />
        </label>
        <button className={buttonClass} type="submit">
          Create account
        </button>
      </form>

      <p className="text-sm text-muted">
        Already have an account?{" "}
        <Link className="text-accent underline" href="/login">
          Sign in
        </Link>
      </p>
    </main>
  );
}

async function ErrorNote({
  searchParams,
}: Pick<PageProps<"/register">, "searchParams">) {
  const { error } = await searchParams;
  const message = typeof error === "string" ? AUTH_ERRORS[error] : undefined;
  if (!message) return null;

  return (
    <p
      role="alert"
      className="rounded-lg border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-danger"
    >
      {message}
    </p>
  );
}
