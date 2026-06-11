/**
 * @module main/license/license-verifier
 *
 * Offline license verification using Ed25519 signatures.
 *
 * A license key is `base64url(payloadJSON).base64url(signature)`. The signature
 * is produced with a PRIVATE key held only by the vendor (scripts/license-gen.js);
 * the app embeds the matching PUBLIC key below and verifies entirely offline — no
 * server, no internet.
 *
 * Supports two binding modes via the payload `mid` field:
 *  - mid = null  → FLOATING / shared key: valid on any machine (used during testing)
 *  - mid = "<id>" → machine-locked: only valid on the machine with that id
 */
import crypto from 'crypto';
import os from 'os';

/** Vendor public key (safe to ship). Pair lives in scripts/license-keys/. */
const LICENSE_PUBLIC_KEY_PEM = `-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEAQ3Nn3LL7SSwI8U5j16IJzNJsXTrJVvMOzk0y2OCduNA=
-----END PUBLIC KEY-----`;

export interface LicensePayload {
  /** schema version */
  v: number;
  /** subject — customer / company name */
  sub: string;
  /** issued-at (epoch seconds) */
  iat: number;
  /** expiry (epoch seconds); null = perpetual */
  exp: number | null;
  /** machine id binding; null = floating/shared key */
  mid: string | null;
  /** optional feature flags */
  feat?: string[];
}

export interface LicenseStatus {
  valid: boolean;
  reason?: string;
  payload?: LicensePayload;
}

function b64urlDecode(input: string): Buffer {
  let s = input.replace(/-/g, '+').replace(/_/g, '/');
  while (s.length % 4) s += '=';
  return Buffer.from(s, 'base64');
}

/**
 * Stable per-machine fingerprint (hostname + first non-internal MAC + platform).
 * Used for machine-locked licenses and shown to the user so the vendor can issue
 * a locked key for their machine.
 */
export function getMachineId(): string {
  const nets = os.networkInterfaces();
  let mac = '';
  for (const name of Object.keys(nets)) {
    for (const ni of nets[name] || []) {
      if (!ni.internal && ni.mac && ni.mac !== '00:00:00:00:00:00') {
        mac = ni.mac;
        break;
      }
    }
    if (mac) break;
  }
  const raw = `${os.hostname()}|${mac}|${os.platform()}|${os.arch()}`;
  return crypto.createHash('sha256').update(raw).digest('hex').slice(0, 32);
}

/** Verify a license key fully offline. */
export function verifyLicenseKey(key: string): LicenseStatus {
  try {
    const trimmed = (key || '').trim().replace(/\s+/g, '');
    if (!trimmed) return { valid: false, reason: 'Chưa nhập license key' };

    const parts = trimmed.split('.');
    if (parts.length !== 2) return { valid: false, reason: 'Định dạng key không hợp lệ' };

    const [payloadB64, sigB64] = parts;
    const signatureOk = crypto.verify(
      null,
      Buffer.from(payloadB64),
      LICENSE_PUBLIC_KEY_PEM,
      b64urlDecode(sigB64)
    );
    if (!signatureOk) {
      return { valid: false, reason: 'Chữ ký không hợp lệ (key giả hoặc đã bị sửa)' };
    }

    const payload = JSON.parse(b64urlDecode(payloadB64).toString('utf8')) as LicensePayload;

    const now = Math.floor(Date.now() / 1000);
    if (payload.exp && now > payload.exp) {
      return { valid: false, reason: 'License đã hết hạn', payload };
    }
    if (payload.mid && payload.mid !== getMachineId()) {
      return { valid: false, reason: 'License bị khóa cho một máy khác', payload };
    }

    return { valid: true, payload };
  } catch (error) {
    return {
      valid: false,
      reason: 'Không đọc được license: ' + (error instanceof Error ? error.message : String(error)),
    };
  }
}
