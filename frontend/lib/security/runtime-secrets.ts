import { GetSecretValueCommand, SecretsManagerClient } from "@aws-sdk/client-secrets-manager";
import { GetParameterCommand, SSMClient } from "@aws-sdk/client-ssm";

/**
 * Secrets web reads from AWS when it starts, so none sits in code, in the image or in the
 * function's configuration:
 * - the OpenAI key, from the SSM SecureString named by OPENAI_API_KEY_PARAM;
 * - the value CloudFront sends in X-Origin-Verify, from the Secrets Manager secret named by
 *   ORIGIN_VERIFY_SECRET_ARN.
 *
 * Under compose neither name is set: the key comes from .env and the origin check is off.
 */

type Senders = {
  ssm?: { send(command: GetParameterCommand): Promise<{ Parameter?: { Value?: string } }> };
  secrets?: { send(command: GetSecretValueCommand): Promise<{ SecretString?: string }> };
};

const region = () => process.env.AWS_REGION || "us-east-1";

/** Called once from instrumentation.ts, before the server takes requests. */
export async function loadRuntimeSecrets(deps: Senders = {}): Promise<void> {
  const param = process.env.OPENAI_API_KEY_PARAM;
  if (param && !process.env.OPENAI_API_KEY) {
    const ssm = deps.ssm ?? new SSMClient({ region: region() });
    const answer = await ssm.send(new GetParameterCommand({ Name: param, WithDecryption: true }));
    if (!answer.Parameter?.Value) throw new Error(`SSM parameter ${param} has no value`);
    process.env.OPENAI_API_KEY = answer.Parameter.Value;
  }

  const secret = await originVerifySecret(deps);
  if (secret) process.env.ORIGIN_VERIFY_SECRET = secret;
}

const fetched = new Map<string, Promise<string>>();

/**
 * The expected X-Origin-Verify value, or undefined when the check is off. The proxy asks for it
 * on every request, so a fetched secret is remembered; a failed fetch is not, and the next
 * request tries again.
 */
export async function originVerifySecret(deps: Senders = {}): Promise<string | undefined> {
  if (process.env.ORIGIN_VERIFY_SECRET) return process.env.ORIGIN_VERIFY_SECRET;
  const arn = process.env.ORIGIN_VERIFY_SECRET_ARN;
  if (!arn) return undefined;

  let pending = fetched.get(arn);
  if (!pending) {
    const secrets = deps.secrets ?? new SecretsManagerClient({ region: region() });
    pending = secrets.send(new GetSecretValueCommand({ SecretId: arn })).then((answer) => {
      if (!answer.SecretString) throw new Error("the origin-verify secret has no value");
      return answer.SecretString;
    });
    fetched.set(arn, pending);
    pending.catch(() => fetched.delete(arn));
  }
  return pending;
}
