const HOST_FINGERPRINT_RE = /^SHA256:[A-Za-z0-9+/]{43}$/;

// OpenSSH SHA256 fingerprints contain 32 digest bytes rendered as unpadded
// Base64. The fingerprint is a PUBLIC trust anchor, not an SSH private key.
export function validateLightsailHostFingerprint(value) {
  if (typeof value !== 'string' || !HOST_FINGERPRINT_RE.test(value)) {
    throw new Error(
      'Missing or invalid Lightsail SSH host fingerprint. Verify host identity independently and configure the production Environment variable before deploying.',
    );
  }
  return value;
}

if (process.argv[1] && import.meta.url === new URL('file://' + process.argv[1]).href) {
  try {
    validateLightsailHostFingerprint(process.env.LIGHTSAIL_SSH_HOST_FINGERPRINT);
    console.log('Production SSH host fingerprint is configured and correctly formatted');
  } catch (error) {
    console.error(error instanceof Error ? error.message : 'Invalid SSH host fingerprint');
    process.exitCode = 1;
  }
}
