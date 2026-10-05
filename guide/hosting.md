# Thursday on a hosted server

The hosted version asks for a **hosting password** before showing the app. This password
protects Thursday and the work she keeps. It is separate from a ChatGPT account or provider
key. A sign-in lasts up to a day; restarting the hosted server signs browsers out. To sign
out, open `/__auth/logout` on the same hosted website and press **Sign out of Thursday**.

The hosted server is a separate computer. Bots can use its files, browser and installed
programs. They cannot automatically reach files, apps or saved website sessions on a user's
computer. Upload the files the task needs, and connect the services needed in the hosted
app's Settings. Account connections in another application are separate.

On a hosting plan that blocks outbound SMTP, a Gmail mailbox needs Gmail HTTPS sending.
Keep its app password for IMAP reading, then create a Google Cloud **web application**
OAuth client. Add the client ID and secret in Settings › API keys, register the hosted
HTTPS address plus `/api/reach/gmail/callback` as its exact redirect URI, and press
**Connect Google** in Settings › Phone › Email. Sign in to the same Gmail account as
Thursday's saved mailbox. Thursday requests Gmail sending, Calendar event access,
and read-only Drive access.
Enable Gmail, Calendar and Drive APIs in the Google Cloud project first. The saved
refresh token is sealed on the persistent volume. Disconnect Google in Settings to revoke Thursday's local token, and revoke its grant in
your Google Account if you also want Google's token invalidated. An OAuth app left in
Google's External Testing mode can have short-lived refresh tokens, so a continuously
running mailbox may require the app's appropriate publishing status and reconnection.
Other mail providers still need a host that permits their SMTP connection or a
provider-specific HTTPS integration; changing the SMTP port cannot bypass a hosting
platform's outbound-mail restriction.

With Google connected, Thursday and her bots can list and create events on the primary
calendar and delete an event by ID. They can search Drive files and read up to 1 MB of
text from plain-text files, Google Docs and Sheets. Other Drive file types appear by
name and link but are not read by this connector.

To connect the owner's existing PC Chrome, download the extension in Settings › Connectors,
unzip it and load the unpacked folder through `chrome://extensions` on that PC. Create a pairing
key in Thursday's Connectors screen, enter it in the extension, and use **Share this tab**
on the one web tab to control. The extension offers Pause and Stop; the server offers Unpair.
Enter that same Thursday server's HTTPS address in the extension before pairing. A key
from another instance, or one replaced by a newer key, is rejected. After allowing the
server permission, reopen the extension and share the tab; the permission prompt may
close its popup. The PC and Chrome must remain on. Thursday never receives the browser
profile or cookies.

Calls need the hosted HTTPS address and microphone permission in the browser. The hosting
password alone does not enable voice or pay for a model: a supported ChatGPT sign-in or
provider configuration must also be available in the hosted app. A subscription's limits
still apply. Hosting and storage charges are separate from model access.
To connect ChatGPT on the hosted server, start **Sign in with ChatGPT** in Settings,
open the offered ChatGPT page and enter the one-time code shown by Thursday. ChatGPT
may ask you to enable device code login in Security settings. This creates a fresh
sign-in for the hosted server; the sign-in on your own computer stays separate.
The hosted Plus voice route can be checked only after this sign-in and a live call.

For ongoing routines and background work, the hosted server must keep running. The hosting
setup uses a persistent data volume and one app instance. The volume keeps memory, files,
settings and sign-ins across deployments. A redeployment can interrupt a running job or
call. Volume persistence is not a backup; keep a separate backup of data that matters.

The hosting password protects access to a powerful assistant. A signed-in person can ask
bots to run commands on the server. This does not add a sandbox around those commands.
Keep the hosting password private, review account connections, and use the site's sign-out
page before leaving a shared browser.

For navigation across websites in the shared tab, reload the installed extension and enable
**Allow automation across websites in the shared tab** in its popup. Chrome asks for website
permission. Commands target only the tab you explicitly shared, including in the background; Pause and
Stop remain available. Pair with the same server that you use in Thursday Settings. A local
pairing key belongs to the local instance; after deployment use the hosted HTTPS address and
create its pairing key there. Keep Chrome open for this connection.

The popup verifies the key with Thursday before saving it and shows the actual server address
and any connection error. Selecting a tab alone does not confirm a server connection. Settings
shows the last Chrome check-in when the connection is offline. A shared tab can stay in the
background while you return to Thursday.

The gateway exposes only three static information pages without a sign-in: `/about`, `/privacy`
and `/terms`, for the connected Google application's consent information. They contain no
instance data. Assistant pages, files, assets and APIs still require the hosting session,
except paired-browser and signed-phone routes which validate their own credentials.
