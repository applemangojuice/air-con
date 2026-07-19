"use client";

/**
 * Last-resort boundary: catches errors in the root layout itself, so it must
 * render its own <html>/<body> and can't rely on globals.css having loaded.
 * Styles are inline for exactly that reason.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  console.error(error);
  return (
    <html lang="en-GB">
      <body
        style={{
          margin: 0,
          minHeight: "100dvh",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          background: "#f8f5ef",
          color: "#1d212b",
          fontFamily: "system-ui, sans-serif",
          textAlign: "center",
          padding: "0 16px",
        }}
      >
        <h1 style={{ fontSize: 28, margin: 0 }}>Something broke</h1>
        <p style={{ maxWidth: 420, color: "#6e7482" }}>
          A rare one: the page itself failed to load. Refreshing almost always
          fixes it.
        </p>
        <button
          type="button"
          onClick={reset}
          style={{
            marginTop: 16,
            padding: "12px 24px",
            borderRadius: 999,
            border: "none",
            background: "#d55a0a",
            color: "#fff",
            fontWeight: 600,
            fontSize: 16,
            cursor: "pointer",
          }}
        >
          Reload
        </button>
      </body>
    </html>
  );
}
