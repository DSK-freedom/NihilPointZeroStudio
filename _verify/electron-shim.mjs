export const app = {
  getPath() { return process.env.CHECK_USERDATA || '.' },
  setPath() {},
  isPackaged: false
}
export const safeStorage = {
  isEncryptionAvailable() { return false },
  encryptString(s) { return Buffer.from(String(s), 'utf-8') },
  decryptString(b) { return Buffer.from(b).toString('utf-8') }
}
export default { app, safeStorage }
