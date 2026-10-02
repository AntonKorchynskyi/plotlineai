import { GetSecretValueCommand } from "@aws-sdk/client-secrets-manager";
import { GetParameterCommand } from "@aws-sdk/client-ssm";
import { afterEach, describe, expect, it, vi } from "vitest";
import { loadRuntimeSecrets, originVerifySecret } from "@/lib/security/runtime-secrets";

afterEach(() => vi.unstubAllEnvs());

const clients = () => {
  const ssm = {
    send: vi.fn(async (command: GetParameterCommand) => ({
      Parameter: { Value: `key-from-${command.input.Name}` },
    })),
  };
  const secrets = {
    send: vi.fn(async (command: GetSecretValueCommand) => ({
      SecretString: `secret-from-${command.input.SecretId}`,
    })),
  };
  return { ssm, secrets };
};

describe("loadRuntimeSecrets", () => {
  it("puts the OpenAI key and the origin secret into the environment", async () => {
    vi.stubEnv("OPENAI_API_KEY", "");
    vi.stubEnv("OPENAI_API_KEY_PARAM", "/plotlineai/openai-api-key");
    vi.stubEnv("ORIGIN_VERIFY_SECRET", "");
    vi.stubEnv("ORIGIN_VERIFY_SECRET_ARN", "arn:load");
    const deps = clients();

    await loadRuntimeSecrets(deps);

    expect(process.env.OPENAI_API_KEY).toBe("key-from-/plotlineai/openai-api-key");
    expect(deps.ssm.send.mock.calls[0][0].input).toEqual({
      Name: "/plotlineai/openai-api-key",
      WithDecryption: true,
    });
    expect(process.env.ORIGIN_VERIFY_SECRET).toBe("secret-from-arn:load");
  });

  it("does nothing where nothing is configured (compose, tests)", async () => {
    vi.stubEnv("OPENAI_API_KEY_PARAM", "");
    vi.stubEnv("ORIGIN_VERIFY_SECRET_ARN", "");
    const deps = clients();

    await loadRuntimeSecrets(deps);

    expect(deps.ssm.send).not.toHaveBeenCalled();
    expect(deps.secrets.send).not.toHaveBeenCalled();
  });
});

describe("originVerifySecret", () => {
  it("is off when neither the secret nor its ARN is set", async () => {
    vi.stubEnv("ORIGIN_VERIFY_SECRET", "");
    vi.stubEnv("ORIGIN_VERIFY_SECRET_ARN", "");
    expect(await originVerifySecret(clients())).toBeUndefined();
  });

  it("uses the value in the environment when there is one", async () => {
    vi.stubEnv("ORIGIN_VERIFY_SECRET", "from-env");
    vi.stubEnv("ORIGIN_VERIFY_SECRET_ARN", "arn:unused");
    expect(await originVerifySecret(clients())).toBe("from-env");
  });

  it("fetches the secret once and remembers it", async () => {
    vi.stubEnv("ORIGIN_VERIFY_SECRET", "");
    vi.stubEnv("ORIGIN_VERIFY_SECRET_ARN", "arn:once");
    const deps = clients();

    expect(await originVerifySecret(deps)).toBe("secret-from-arn:once");
    expect(await originVerifySecret(deps)).toBe("secret-from-arn:once");
    expect(deps.secrets.send).toHaveBeenCalledTimes(1);
  });

  it("tries again after a failed fetch instead of remembering the failure", async () => {
    vi.stubEnv("ORIGIN_VERIFY_SECRET", "");
    vi.stubEnv("ORIGIN_VERIFY_SECRET_ARN", "arn:retry");
    const deps = clients();
    deps.secrets.send.mockRejectedValueOnce(new Error("throttled"));

    await expect(originVerifySecret(deps)).rejects.toThrow("throttled");
    expect(await originVerifySecret(deps)).toBe("secret-from-arn:retry");
  });
});
