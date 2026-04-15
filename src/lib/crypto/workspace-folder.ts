/**
 * Client-side helper: generate the crypto payload for a new workspace root
 * folder. Shared by the workspace switcher's "Create workspace" modal and
 * the onboarding wizard. Uses the user's keys from sessionStorage, so this
 * only runs in the browser after unlock.
 */
export async function buildWorkspaceFolder(name: string) {
  const {
    generateSessionKey,
    encryptMetadata,
    generateHierarchicalKeypair,
    wrapSessionKeyToFile,
    wrapPrivateHierarchicalKeyForUser,
  } = await import("@/lib/crypto/file-crypto");

  const keysStr = sessionStorage.getItem("securewarp_keys");
  if (!keysStr) throw new Error("Not signed in");
  const keys = JSON.parse(keysStr) as {
    encryptionPublicKey: string;
    encryptionPrivateKey: string;
  };

  const sessionKey = generateSessionKey();
  try {
    const hier = generateHierarchicalKeypair();
    const encryptedMetadata = encryptMetadata(
      { name, type: "folder", size: 0 },
      sessionKey
    );
    const { encryptedSessionKeyByFile, sessionKeyNonce } = wrapSessionKeyToFile(
      sessionKey,
      hier.publicKey,
      keys.encryptionPrivateKey
    );
    const encryptedPrivateHierarchicalKey = wrapPrivateHierarchicalKeyForUser(
      hier.privateKey,
      keys.encryptionPublicKey,
      keys.encryptionPrivateKey
    );

    return {
      encryptedMetadata: JSON.stringify(encryptedMetadata),
      parentId: null,
      publicHierarchicalKey: hier.publicKey,
      encryptedSessionKeyByFile,
      sessionKeyNonce,
      encryptedPrivateHierarchicalKey,
      wrappedByPublicKey: keys.encryptionPublicKey,
    };
  } finally {
    sessionKey.fill(0);
  }
}
