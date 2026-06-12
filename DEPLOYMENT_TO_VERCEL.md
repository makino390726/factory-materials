# Deploy to Vercel

This project is a Next.js app (App Router). Use Vercel to deploy.

## Pre-requirements
- A Vercel account
- The repository pushed to GitHub/GitLab/Bitbucket (recommended)
- Environment variables need to be set in Vercel (do NOT commit secrets to the repo)

Required environment variables (example names used in code):
- `NEXT_PUBLIC_SUPABASE_URL` (public)
- `SUPABASE_SERVICE_ROLE_KEY` (secret)

## Quick deploy (recommended)
1. Push your branch to the remote (GitHub).
2. In Vercel dashboard, click "New Project" and import the repository.
3. During setup, add the environment variables above in the Vercel project settings (Production and Preview as needed).
4. Vercel will automatically detect Next.js and use `npm run build` as the build step.

## Deploy via Vercel CLI
Install CLI and login:

```bash
npm i -g vercel
vercel login
```

From the repository root:

```bash
vercel link    # link to the Vercel project (or create one)
vercel env add NEXT_PUBLIC_SUPABASE_URL production
vercel env add SUPABASE_SERVICE_ROLE_KEY production
# follow prompts to add values
vercel --prod
```

## Notes
- Do not store `SUPABASE_SERVICE_ROLE_KEY` in the repo. Add it via Vercel Dashboard or `vercel env add`.
- If you need to customize build command or output directory, set them in Vercel project settings. Default Next.js settings should work.
- If you use Preview/Production separate values, add variables for both environments.

If you want, I can:
- Create a `now.json`/`vercel.json` (already added) with extra routing rules.
- Add CI scripts or GitHub Actions to automatically run `npm run build` and deploy.

If you want me to perform the CLI deploy from this environment, grant permission and ensure Vercel CLI is installed and you have logged-in credentials in this terminal session.