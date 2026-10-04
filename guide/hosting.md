# Thursday on a hosted server

The hosted version asks for a **hosting password** before showing the app. This password
protects Thursday and the work she keeps. It is separate from a ChatGPT account or provider
key. A sign-in lasts up to a day; restarting the hosted server signs browsers out. To sign
out, open `/__auth/logout` on the same hosted website and press **Sign out of Thursday**.

The hosted server is a separate computer. Bots can use its files, browser and installed
programs. They cannot automatically reach files, apps or saved website sessions on a user's
computer. Upload the files the task needs, and connect the services needed in the hosted
app's Settings. Account connections in another application are separate.

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
