# Code signing — the permanent fix for Smart App Control / SmartScreen

Unsigned builds of NIHILPOINTZERO-OS get blocked by Smart App Control (hard block, no
"Run anyway") and warned about by SmartScreen on every new exe. Signing each build with a
publicly trusted certificate makes every future build trusted **everywhere, immediately** —
on this PC and anyone else's — without touching any Windows security setting.

## Recommended: Azure Trusted Signing (~US$9.99/month)

Microsoft's own signing service; electron-builder supports it natively, and its
certificates carry the reputation Smart App Control checks for.

### One-time setup (~1 hour + identity validation wait)
1. Create an Azure account → portal.azure.com.
2. Create a **Trusted Signing account** (pick a nearby region, note the *endpoint URL*).
3. Complete **Individual identity validation** (government ID; typically 1–3 days).
4. Create a **certificate profile** (Public Trust) under the account.
5. Create an **App registration** (Entra ID) → note *tenant ID*, *client ID*; create a
   *client secret*. Give it the "Trusted Signing Certificate Profile Signer" role on the
   signing account.

### Wire it into the build
1. In `electron-builder.yml`, uncomment the `azureSignOptions` block (top of the `win:`
   section) and fill in the four values from the steps above.
2. Set the environment variables before packaging:
   ```powershell
   $env:AZURE_TENANT_ID = '…'
   $env:AZURE_CLIENT_ID = '…'
   $env:AZURE_CLIENT_SECRET = '…'
   npm run dist:win
   ```
3. Verify: right-click the built exe → Properties → Digital Signatures shows your name;
   `signtool verify /pa release\NIHILPOINTZERO-OS-portable.exe` passes.

Both the portable exe and the NSIS installer get signed automatically.

## Why not a self-signed certificate?
Smart App Control ignores self-signed certificates entirely — it only trusts
publicly-trusted CAs with reputation. Self-signing would change nothing.

## Until signing is active
- Smart App Control (enforcing) blocks every NEW build outright. The machine's
  administrator can turn SAC off (Windows Security → App & browser control) — a one-way
  switch; SmartScreen + Defender remain active afterwards.
- SAC cloud verdicts can also flip on their own within days for a clean exe — retrying a
  blocked build later sometimes just works.
