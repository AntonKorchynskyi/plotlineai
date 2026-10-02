/**
 * Runs once when the server starts, before it takes requests: on AWS this is where web reads
 * its secrets (lib/security/runtime-secrets.ts). A failure here fails the start, which beats
 * serving pages that cannot reach OpenAI or check their origin.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { loadRuntimeSecrets } = await import("@/lib/security/runtime-secrets");
    await loadRuntimeSecrets();
  }
}
