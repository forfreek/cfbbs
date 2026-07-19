const textEncoder = new TextEncoder();

const signingAlgorithm: RsaHashedKeyGenParams = {
  name: "RSASSA-PKCS1-v1_5",
  modulusLength: 2048,
  publicExponent: new Uint8Array([1, 0, 1]),
  hash: "SHA-256",
};

type EncryptedKey = {
  version: 1;
  iv: string;
  ciphertext: string;
};

function toBase64(value: ArrayBuffer) {
  let binary = "";
  for (const byte of new Uint8Array(value)) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
}

function fromBase64(value: string) {
  const binary = atob(value);
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  return bytes.buffer as ArrayBuffer;
}

function pem(label: string, value: ArrayBuffer) {
  const base64 = toBase64(value);
  const lines = base64.match(/.{1,64}/g)?.join("\n") ?? "";
  return `-----BEGIN ${label}-----\n${lines}\n-----END ${label}-----`;
}

async function encryptionKey(
  secret: string,
  usages: KeyUsage[],
): Promise<CryptoKey> {
  const material = await crypto.subtle.digest(
    "SHA-256",
    textEncoder.encode(secret),
  );
  return crypto.subtle.importKey("raw", material, "AES-GCM", false, usages);
}

function parseEncryptedKey(value: string): EncryptedKey {
  try {
    const parsed = JSON.parse(value) as Partial<EncryptedKey>;
    if (
      parsed.version !== 1 ||
      typeof parsed.iv !== "string" ||
      typeof parsed.ciphertext !== "string"
    ) {
      throw new Error();
    }
    return parsed as EncryptedKey;
  } catch {
    throw new Error("Invalid encrypted federation private key.");
  }
}

export async function encryptPrivateKey(
  privateKey: ArrayBuffer,
  secret: string,
) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    await encryptionKey(secret, ["encrypt"]),
    privateKey,
  );
  return JSON.stringify({
    version: 1,
    iv: toBase64(iv.buffer as ArrayBuffer),
    ciphertext: toBase64(ciphertext),
  } satisfies EncryptedKey);
}

export async function decryptPrivateKey(value: string, secret: string) {
  const encrypted = parseEncryptedKey(value);
  try {
    return await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: new Uint8Array(fromBase64(encrypted.iv)) },
      await encryptionKey(secret, ["decrypt"]),
      fromBase64(encrypted.ciphertext),
    );
  } catch {
    throw new Error("Unable to decrypt federation private key.");
  }
}

export async function generateFederationSigningKeyPair(secret: string) {
  const pair = (await crypto.subtle.generateKey(signingAlgorithm, true, [
    "sign",
    "verify",
  ])) as CryptoKeyPair;
  const [publicKey, privateKey] = await Promise.all([
    crypto.subtle.exportKey("spki", pair.publicKey),
    crypto.subtle.exportKey("pkcs8", pair.privateKey),
  ]);

  return {
    publicKeyPem: pem("PUBLIC KEY", publicKey),
    privateKeyEncrypted: await encryptPrivateKey(privateKey, secret),
  };
}
