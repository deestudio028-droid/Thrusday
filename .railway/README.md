# Railway deployment

`railway.ts` describes this fork's single `thursday` service and `/app/data` volume.
It sets the Docker build, health check, one replica, restart policy and no-sleep
setting. Password hash and session secret are kept in Railway variables as
`preserve()` values; they are never committed here.

From this repository, sign in to Railway and link the existing **Thrusday**
project's production environment. Use `railway config plan` to review changes,
then `railway config apply` to apply the reviewed plan. Code pushed to `main`
builds from the linked GitHub source after the service is connected. The plan
does not apply itself on each code push. Keep `/app/data` attached to one replica
so the database, workspace and sign-in secrets persist across deployments.