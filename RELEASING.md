# Releasing

The package is currently named `@local/dsh-verification-kernel` and has
`"private": true` so it can be installed by path during local development.
It is **not** directly publishable to npm under the `@local` scope.

## GitHub source release

1. Create an empty GitHub repository.
2. Add the remote and push:
   ```bash
   git remote add origin <your-repo-url>
   git branch -M main
   git push -u origin main
   ```
3. Tag a release:
   ```bash
   git tag v0.1.0
   git push origin v0.1.0
   ```
   `.github/workflows/release.yml` runs tests, creates an npm tarball, and
   attaches it to the GitHub release.

## npm publish (optional)

To publish to npm:

1. Rename the package and update `cordis.patch.yml`'s `name` to match.
2. Remove `"private": true`.
3. Choose a scope you own, for example
   `@your-scope/dsh-verification-kernel`.
4. Add `NPM_TOKEN` and a publish workflow.

Do not publish under `@local`; that scope is for local links only.

## Install from a GitHub release tarball

```bash
pnpm add <path-to>/local-dsh-verification-kernel-0.1.0.tgz
```

or keep using a local link for development.
